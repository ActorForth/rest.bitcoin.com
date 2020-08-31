/*
  TESTS FOR THE ADDRESS.JS ROUTE LIBRARY

  TODO:
  - Test addresses with large transaction history that will have paginated results.
*/

const assert = require("chai").assert
const sinon = require("sinon")

const AddressRoute = require("../../../src/routes/v3/address-new.js")

let uut

// Mocking data.
const { mockReq, mockRes } = require("../mocks/express-mocks")
const mockData = require("../mocks/address-mock")

// Used for debugging.
const util = require("util")
util.inspect.defaultOptions = { depth: 1 }

process.env.NETWORK = process.env.NETWORK ? process.env.NETWORK : "mainnet"
console.log(`process.env.NETWORK: ${process.env.NETWORK}`)

describe("#AddressRouter", () => {
  let req, res

  before(() => {
    sandbox = sinon.createSandbox()
  })

  afterEach(() => sandbox.restore())

  // Setup the mocks before each test.
  beforeEach(() => {
    // Mock the req and res objects used by Express routes.
    req = mockReq
    res = mockRes

    // Explicitly reset the parmas and body.
    req.params = {}
    req.body = {}
    req.query = {}

    uut = new AddressRoute()

    sandbox = sinon.createSandbox()
  })

  afterEach(() => sandbox.restore())

  describe("#root", () => {
    it("should respond to GET for base route", async () => {
      const result = uut.root(req, res)

      assert.equal(result.status, "address-v3", "Returns static string")
    })
  })

  describe("#balance", () => {
    it("should throw an error for an empty body", async () => {
      req.body = {}

      const result = await uut.balance(req, res)
      //console.log(`result: ${util.inspect(result)}`)

      assert.equal(res.statusCode, 400, "HTTP status code 400 expected.")
      assert.include(
        result.error,
        "addresses needs to be an array",
        "Proper error message"
      )
    })

    it("should error on non-array single address", async () => {
      req.body = {
        address: `qzs02v05l7qs5s24srqju498qu55dwuj0cx5ehjm2c`
      }

      const result = await uut.balance(req, res)

      assert.equal(res.statusCode, 400, "HTTP status code 400 expected.")
      assert.include(
        result.error,
        "addresses needs to be an array",
        "Proper error message"
      )
    })

    it("should throw an error for an invalid address", async () => {
      req.body = {
        addresses: [`02v05l7qs5s24srqju498qu55dwuj0cx5ehjm2c`]
      }

      const result = await uut.balance(req, res)

      assert.equal(res.statusCode, 400, "HTTP status code 400 expected.")
      assert.include(
        result.error,
        "Invalid BCH address",
        "Proper error message"
      )
    })

    it("should throw 400 error if addresses array is too large", async () => {
      const testArray = []
      for (var i = 0; i < 25; i++) testArray.push("")

      req.body.addresses = testArray

      const result = await uut.balance(req, res)
      //console.log(`result: ${util.inspect(result)}`)

      assert.hasAllKeys(result, ["error"])
      assert.include(result.error, "Array too large")
    })

    it("should detect a network mismatch", async () => {
      console.log(">>>>>>>>>>>Insight error 1")
      req.body = {
        addresses: [`bchreg:qqusw0rhqlm3uxffdcp9d7w97mh5f5r58cw65ymzum`]
      }

      const result = await uut.balance(req, res)
      //console.log(`result: ${util.inspect(result)}`)
      console.log('RES.STATUSCODE', res.statusCode)
      assert.equal(res.statusCode, 400, "HTTP status code 400 expected.")
      console.log('RESULT.ERROR', result.error)
      assert.include(result.error, "Invalid network", "Proper error message")
    })

    it("should get details for a single address", async () => {
      // Mock the indexer library so that live network calls are not made.
      sandbox.stub(uut.ninsight, "balance").resolves(mockData.mockBalance)

      req.body = {
        addresses: [`bchreg:qqusw0rhqlm3uxffdcp9d7w97mh5f5r58cw65ymzum`]
      }

      // Call the details API.
      const result = await uut.balance(req, res)

      // Assert that required fields exist in the returned object.
      assert.equal(result.length, 1, "Array with one entry")

      // Ensure the returned value meets the specificiations in /docs/v3/api-spec.md
      assert.property(result[0], "balance")
      assert.isNumber(result[0].balance)
      assert.property(result[0], "balanceSat")
      assert.isNumber(result[0].balanceSat)
      assert.property(result[0], "totalReceived")
      assert.isNumber(result[0].totalReceived)
      assert.property(result[0], "totalReceivedSat")
      assert.isNumber(result[0].totalReceivedSat)
      assert.property(result[0], "totalSent")
      assert.isNumber(result[0].totalSent)
      assert.property(result[0], "totalSentSat")
      assert.isNumber(result[0].totalSentSat)
      assert.property(result[0], "unconfirmedBalance")
      assert.isNumber(result[0].unconfirmedBalance)
      assert.property(result[0], "unconfirmedBalanceSat")
      assert.isNumber(result[0].unconfirmedBalanceSat)
      assert.property(result[0], "unconfirmedTxApperances")
      assert.isNumber(result[0].unconfirmedTxApperances)
      assert.property(result[0], "txApperances")
      assert.isNumber(result[0].txApperances)
      assert.property(result[0], "slpData")
      assert.property(result[0], "transactions")
      assert.isArray(result[0].transactions)
      assert.property(result[0], "address")
      assert.isString(result[0].address)
      assert.property(result[0], "addressLegacy")
      assert.isString(result[0].addressLegacy)
      assert.property(result[0], "addressSlp")
      assert.isString(result[0].addressSlp)
    })

    it("should get details for multiple addresses", async () => {
      // Mock the indexer library so that live network calls are not made.
      sandbox.stub(uut.ninsight, "balance").resolves(mockData.mockBalance)

      req.body = {
        addresses: [
          `bchreg:qren0vw0ru8l5v39ne6ru3dlg630w7s3u5rjk5lhra`,
          `bchreg:qren0vw0ru8l5v39ne6ru3dlg630w7s3u5rjk5lhra`
        ]
      }

      // Call the details API.
      const result = await uut.balance(req, res)
      // console.log(`result: ${util.inspect(result)}`)

      assert.isArray(result)
      assert.equal(result.length, 2, "2 outputs for 2 inputs")
    })

    it("should query Blockbook if flag is set", async () => {
      // Mock the indexer library so that live network calls are not made.
      sandbox.stub(uut.blockbook, "balance").resolves(mockData.mockBalance)

      req.body = {
        addresses: [`bchreg:qren0vw0ru8l5v39ne6ru3dlg630w7s3u5rjk5lhra`]
      }

      // Set the Blockbook indexer flag
      uut.indexer = "BLOCKBOOK"

      // Call the details API.
      const result = await uut.balance(req, res)
      // console.log(`result: ${util.inspect(result)}`)

      // Assert that required fields exist in the returned object.
      assert.equal(result.length, 1, "Array with one entry")
    })

    it("should catch and report unhandled errors", async () => {
      // Mock the indexer library so that live network calls are not made.
      sandbox.stub(uut.ninsight, "balance").rejects(new Error("test error"))

      req.body = {
        addresses: [`bchreg:qren0vw0ru8l5v39ne6ru3dlg630w7s3u5rjk5lhra`]
      }

      // Call the details API.
      const result = await uut.balance(req, res)
      // console.log(`result: ${JSON.stringify(result, null, 2)}`)

      assert.property(result, "error")
    })

    it("should catch and report handled errors", async () => {
      // Mock the indexer library so that live network calls are not made.
      sandbox.stub(uut.ninsight, "balance").rejects(new Error("ENOTFOUND"))

      req.body = {
        addresses: [`bchreg:qren0vw0ru8l5v39ne6ru3dlg630w7s3u5rjk5lhra`]
      }

      // Call the details API.
      const result = await uut.balance(req, res)
      // console.log(`result: ${JSON.stringify(result, null, 2)}`)

      assert.property(result, "error")
      assert.include(result.error, "Network error")
    })
  })

  describe("#utxo", () => {
    it("should throw an error for an empty body", async () => {
      req.body = {}

      const result = await uut.utxo(req, res)
      //console.log(`result: ${util.inspect(result)}`)

      assert.equal(res.statusCode, 400, "HTTP status code 400 expected.")
      assert.include(
        result.error,
        "addresses needs to be an array",
        "Proper error message"
      )
    })

    it("should error on non-array single address", async () => {
      req.body = {
        address: `qzs02v05l7qs5s24srqju498qu55dwuj0cx5ehjm2c`
      }

      const result = await uut.utxo(req, res)

      assert.equal(res.statusCode, 400, "HTTP status code 400 expected.")
      assert.include(
        result.error,
        "addresses needs to be an array",
        "Proper error message"
      )
    })

    it("should throw an error for an invalid address", async () => {
      req.body = {
        addresses: [`02v05l7qs5s24srqju498qu55dwuj0cx5ehjm2c`]
      }

      const result = await uut.utxo(req, res)

      assert.equal(res.statusCode, 400, "HTTP status code 400 expected.")
      assert.include(
        result.error,
        "Invalid BCH address",
        "Proper error message"
      )
    })

    it("should throw 400 error if addresses array is too large", async () => {
      const testArray = []
      for (var i = 0; i < 25; i++) testArray.push("")

      req.body.addresses = testArray

      const result = await uut.utxo(req, res)
      //console.log(`result: ${util.inspect(result)}`)

      assert.hasAllKeys(result, ["error"])
      assert.include(result.error, "Array too large")
    })

    it("should detect a network mismatch", async () => {
      req.body = {
        addresses: [`bchreg:qpvcxgezthtaksnklt4u055act36h6k36chhx8x56l`]
      }

      const result = await uut.utxo(req, res)
      //console.log(`result: ${util.inspect(result)}`)

      assert.equal(res.statusCode, 400, "HTTP status code 400 expected.")
      assert.include(result.error, "Invalid network", "Proper error message")
    })

    it("should get details for a single address", async () => {
      console.log(">>>>>>>>>>>>>>>Insight error 2")

      // Mock the indexer library so that live network calls are not made.
      sandbox.stub(uut.ninsight, "utxo").resolves(mockData.mockUtxo)

      req.body = {
        addresses: [`bchreg:qren0vw0ru8l5v39ne6ru3dlg630w7s3u5rjk5lhra`]
      }

      // Call the details API.
      const result = await uut.utxo(req, res)
      // console.log(`result: ${util.inspect(result)}`)

      // Assert that required fields exist in the returned object.
      assert.equal(result.length, 1, "Array with one entry")

      // Ensure the returned value meets the specificiations in /docs/v3/api-spec.md
      assert.property(result[0], "address")

      assert.property(result[0], "utxos")
      assert.isArray(result[0].utxos)

      assert.property(result[0].utxos[0], "txid")
      assert.isString(result[0].utxos[0].txid)

      assert.property(result[0].utxos[0], "index")
      assert.isNumber(result[0].utxos[0].index)

      assert.property(result[0].utxos[0], "satoshis")
      assert.isNumber(result[0].utxos[0].satoshis)

      assert.property(result[0].utxos[0], "height")
      assert.isNumber(result[0].utxos[0].height)

      assert.property(result[0].utxos[0], "slpData")
      assert.property(result[0].utxos[0].slpData, "isSlp")
      assert.equal(result[0].utxos[0].slpData.isSlp, false)
    })

    it("should get details for multiple addresses", async () => {
      // Mock the indexer library so that live network calls are not made.
      sandbox.stub(uut.ninsight, "utxo").resolves(mockData.mockUtxo)

      req.body = {
        addresses: [
          `bchreg:qren0vw0ru8l5v39ne6ru3dlg630w7s3u5rjk5lhra`,
          `bchreg:qren0vw0ru8l5v39ne6ru3dlg630w7s3u5rjk5lhra`
        ]
      }

      // Call the details API.
      const result = await uut.utxo(req, res)
      // console.log(`result: ${util.inspect(result)}`)

      assert.isArray(result)
      assert.equal(result.length, 2, "2 outputs for 2 inputs")
    })

    it("should query Blockbook if flag is set", async () => {
      // Mock the indexer library so that live network calls are not made.
      sandbox.stub(uut.blockbook, "utxo").resolves(mockData.mockUtxo)

      req.body = {
        addresses: [`bchreg:qren0vw0ru8l5v39ne6ru3dlg630w7s3u5rjk5lhra`]
      }

      // Set the Blockbook indexer flag
      uut.indexer = "BLOCKBOOK"

      // Call the details API.
      const result = await uut.utxo(req, res)
      // console.log(`result: ${util.inspect(result)}`)

      // Assert that required fields exist in the returned object.
      assert.equal(result.length, 1, "Array with one entry")
    })

    it("should catch and report unhandled errors", async () => {
      // Mock the indexer library so that live network calls are not made.
      sandbox.stub(uut.ninsight, "utxo").rejects(new Error("test error"))

      req.body = {
        addresses: [`bchreg:qren0vw0ru8l5v39ne6ru3dlg630w7s3u5rjk5lhra`]
      }

      // Call the details API.
      const result = await uut.utxo(req, res)
      // console.log(`result: ${JSON.stringify(result, null, 2)}`)

      assert.property(result, "error")
    })

    it("should catch and report handled errors", async () => {
      // Mock the indexer library so that live network calls are not made.
      sandbox.stub(uut.ninsight, "utxo").rejects(new Error("ENOTFOUND"))

      req.body = {
        addresses: [`bchreg:qren0vw0ru8l5v39ne6ru3dlg630w7s3u5rjk5lhra`]
      }

      // Call the details API.
      const result = await uut.utxo(req, res)
      // console.log(`result: ${JSON.stringify(result, null, 2)}`)

      assert.property(result, "error")
      assert.include(result.error, "Network error")
    })
  })
})
