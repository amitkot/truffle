import debugModule from "debug";
const debug = debugModule("test:data:decode");

import Ganache from "ganache-cli";
import { assert } from "chai";
import changeCase from "change-case";

import { prepareContracts } from "test/helpers";

import Debugger from "lib/debugger";

import { cleanBigNumbers } from "lib/data/decode/utils";

import data from "lib/data/selectors";
import solidity from "lib/solidity/selectors";

export function* generateUints() {
  let x = 0;
  while (true) {
    yield x;
    x++;
  }
}

function contractName(testName) {
  return testName.replace(/ /g, "");
}

function fileName(testName) {
  return `${contractName(testName)}.sol`;
}

function generateTests(fixtures) {
  for (let { name, value: expected } of fixtures) {
    it(`correctly decodes ${name}`, () => {
      assert.deepEqual(this.decode(name), expected);
    });
  }
}

function lastStatementLine(source) {
  const lines = source.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    let line = lines[i];
    if (line.indexOf(";") != -1) {
      return i;
    }
  }
}

async function prepareDebugger(testName, sources) {
  const provider = Ganache.provider({ seed: "debugger", gasLimit: 7000000 });

  let { abstractions, artifacts: contracts, files } = await prepareContracts(
    provider,
    sources
  );

  let instance = await abstractions[contractName(testName)].deployed();
  let receipt = await instance.run();
  let txHash = receipt.tx;

  let bugger = await Debugger.forTx(txHash, { provider, files, contracts });

  let session = bugger.connect();

  let source = sources[fileName(testName)];

  //we'll need the debugger-internal ID of this source
  let debuggerSources = session.view(solidity.info.sources);
  let matchingSources = Object.values(debuggerSources).filter(sourceObject =>
    sourceObject.sourcePath.includes(contractName(testName))
  );
  let sourceId = matchingSources[0].id;

  let breakpoint = {
    sourceId,
    line: lastStatementLine(source)
  };

  session.addBreakpoint(breakpoint);

  session.continueUntilBreakpoint();

  return session;
}

async function getDecode(session) {
  const definitions = session.view(data.current.identifiers.definitions);
  const refs = session.view(data.current.identifiers.refs);

  const decode = session.view(data.views.decoder);
  return name => cleanBigNumbers(decode(definitions[name], refs[name]));
}

export function describeDecoding(testName, fixtures, selector, generateSource) {
  const sources = {
    [fileName(testName)]: generateSource(contractName(testName), fixtures)
  };

  describe(testName, function() {
    const testDebug = debugModule(
      `test:data:decode:${changeCase.paramCase(testName)}`
    );

    testDebug("source %s", Object.values(sources)[0]);

    this.timeout(30000);

    before("runs and observes debugger", async () => {
      const session = await prepareDebugger(testName, sources);
      this.decode = await getDecode(session);

      if (selector) {
        debug("selector %O", session.view(selector));
      }
    });

    generateTests.bind(this)(fixtures);
  });
}
