"use strict"

const blockRoute = require("../../dist/routes/v2/block")
const chai = require("chai")
const assert = chai.assert
const nock = require("nock") // HTTP mocking

let originalEnvVars // Used during transition from integration to unit tests.

// Mocking data.
const { mockReq, mockRes } = require("./mocks/express-mocks")
const mockData = require("./mocks/block-mock")

// Used for debugging.
const util = require("util")
util.inspect.defaultOptions = { depth: 1 }

describe("#Block", () => {
  let req, res

  before(() => {
    // Save existing environment variables.
    originalEnvVars = {
      BITCOINCOM_BASEURL: process.env.BITCOINCOM_BASEURL,
      RPC_BASEURL: process.env.RPC_BASEURL,
      RPC_USERNAME: process.env.RPC_USERNAME,
      RPC_PASSWORD: process.env.RPC_PASSWORD
    }

    // Set default environment variables for unit tests.
    if (!process.env.TEST) process.env.TEST = "unit"
    if (process.env.TEST === "unit") {
      process.env.BITCOINCOM_BASEURL = "http://fakeurl/api/"
      process.env.RPC_BASEURL = "http://fakeurl/api"
      process.env.RPC_USERNAME = "fakeusername"
      process.env.RPC_PASSWORD = "fakepassword"
    }
  })

  // Setup the mocks before each test.
  beforeEach(() => {
    // Mock the req and res objects used by Express routes.
    req = mockReq
    res = mockRes

    // Explicitly reset the parmas and body.
    req.params = {}
    req.body = {}

    // Activate nock if it's inactive.
    if (!nock.isActive()) nock.activate()
  })

  afterEach(() => {
    // Clean up HTTP mocks.
    nock.cleanAll() // clear interceptor list.
    nock.restore()
  })

  after(() => {
    // Restore any pre-existing environment variables.
    process.env.BITCOINCOM_BASEURL = originalEnvVars.BITCOINCOM_BASEURL
    process.env.RPC_BASEURL = originalEnvVars.RPC_BASEURL
    process.env.RPC_USERNAME = originalEnvVars.RPC_USERNAME
    process.env.RPC_PASSWORD = originalEnvVars.RPC_PASSWORD
  })

  describe("#root", () => {
    // root route handler.
    const root = blockRoute.testableComponents.root

    it("should respond to GET for base route", async () => {
      const result = root(req, res)

      assert.equal(result.status, "block", "Returns static string")
    })
  })

  describe("#detailsByHashSingle", () => {
    const detailsByHash = blockRoute.testableComponents.detailsByHashSingle

    it("should throw an error for an empty hash", async () => {
      req.params.hash = ""

      const result = await detailsByHash(req, res)

      assert.equal(res.statusCode, 400, "HTTP status code 400 expected.")
      assert.include(
        result.error,
        "hash must not be empty",
        "Proper error message"
      )
    })

    it("should throw 500 when network issues", async () => {
      // Save the existing RPC URL.
      const savedUrl = process.env.BITCOINCOM_BASEURL

      // Manipulate the URL to cause a 500 network error.
      process.env.BITCOINCOM_BASEURL = "http://fakeurl/api/"

      req.params.hash = "abc123"
      const result = await detailsByHash(req, res)
      //console.log(`result: ${util.inspect(result)}`)

      // Restore the saved URL.
      process.env.BITCOINCOM_BASEURL = savedUrl

      assert.equal(res.statusCode, 500, "HTTP status code 500 expected.")
      //assert.include(result.error, "ENOTFOUND", "Error message expected")
    })

    it("should throw an error for invalid hash", async () => {
      req.params.hash = "abc123"

      // Mock the Insight URL for unit tests.
      if (process.env.TEST === "unit") {
        nock(`${process.env.BITCOINCOM_BASEURL}`)
          .get(`/block/${req.params.hash}`)
          .reply(404, { statusText: "Not Found" })
      }

      const result = await detailsByHash(req, res)
      //console.log(`result: ${util.inspect(result)}`)

      assert.equal(res.statusCode, 404, "HTTP status code 404 expected.")
      assert.include(result.error, "Not Found", "Proper error message")
    })

    it("should GET /detailsByHash/:hash", async () => {
      req.params.hash =
        "00000000000000645dec6503d3f5eafb0d2537a7a28f181d721dec7c44154c79"

      // Mock the Insight URL for unit tests.
      if (process.env.TEST === "unit") {
        nock(`${process.env.BITCOINCOM_BASEURL}`)
          .get(`/block/${req.params.hash}`)
          .reply(200, mockData.mockBlockDetails)
      }

      const result = await detailsByHash(req, res)
      //console.log(`result: ${util.inspect(result)}`)

      assert.hasAnyKeys(result, [
        "hash",
        "size",
        "height",
        "version",
        "merkleroot",
        "tx",
        "time",
        "nonce",
        "bits",
        "difficulty",
        "chainwork",
        "confirmations",
        "previousblockhash",
        "nextblockhash",
        "reward",
        "isMainChain",
        "poolInfo"
      ])
      assert.isArray(result.tx)
    })
  })

  describe("#detailsByHashBulk", () => {
    // details route handler.
    const detailsByHashBulk = blockRoute.testableComponents.detailsByHashBulk

    it("should throw an error for an empty body", async () => {
      req.body = {}

      const result = await detailsByHashBulk(req, res)

      assert.equal(res.statusCode, 400, "HTTP status code 400 expected.")
      assert.include(
        result.error,
        "hashes needs to be an array",
        "Proper error message"
      )
    })

    it("should error on non-array single address", async () => {
      req.body = {
        hashes:
          "00000000000000645dec6503d3f5eafb0d2537a7a28f181d721dec7c44154c79"
      }

      const result = await detailsByHashBulk(req, res)

      assert.equal(res.statusCode, 400, "HTTP status code 400 expected.")
      assert.include(
        result.error,
        "hashes needs to be an array",
        "Proper error message"
      )
    })

    it("should throw 400 error if addresses array is too large", async () => {
      const testArray = []
      for (var i = 0; i < 25; i++) testArray.push("")

      req.body.hashes = testArray

      const result = await detailsByHashBulk(req, res)
      //console.log(`result: ${util.inspect(result)}`)

      assert.hasAllKeys(result, ["error"])
      assert.include(result.error, "Array too large")
    })

    it("should throw an error for an invalid hash", async () => {
      req.body = {
        hashes: [`abc123`]
      }

      const result = await detailsByHashBulk(req, res)
      //console.log(`result: ${util.inspect(result)}`)

      assert.equal(res.statusCode, 400, "HTTP status code 400 expected.")
      assert.include(result.error, "Invalid hash", "Proper error message")
    })

    it("should throw 500 when network issues", async () => {
      const savedUrl = process.env.BITCOINCOM_BASEURL

      try {
        req.body = {
          hashes: [
            "00000000000000645dec6503d3f5eafb0d2537a7a28f181d721dec7c44154c79"
          ]
        }

        // Switch the Insight URL to something that will error out.
        process.env.BITCOINCOM_BASEURL = "http://fakeurl/api/"

        const result = await detailsByHashBulk(req, res)

        // Restore the saved URL.
        process.env.BITCOINCOM_BASEURL = savedUrl

        assert.equal(res.statusCode, 500, "HTTP status code 500 expected.")
        assert.include(result.error, "ENOTFOUND", "Error message expected")
      } catch (err) {
        // Restore the saved URL.
        process.env.BITCOINCOM_BASEURL = savedUrl
      }
    })
    /*
    it("should get details for a single hash", async () => {
      req.body = {
        hashes: [
          "00000000000000645dec6503d3f5eafb0d2537a7a28f181d721dec7c44154c79"
        ]
      }

      // Mock the Insight URL for unit tests.
      if (process.env.TEST === "unit") {
        nock(`${process.env.BITCOINCOM_BASEURL}`)
          .get(`/block/${req.params.hashes[0]}`)
          .reply(200, [mockData.mockBlockDetails])
      }

      // Call the details API.
      const result = await detailsByHashBulk(req, res)
      console.log(`result: ${util.inspect(result)}`)

      // Assert that required fields exist in the returned object.
      assert.equal(result.length, 1, "Array with one entry")
      assert.hasAllKeys(result[0], [
        "bits",
        "chainwork",
        "confirmations",
        "difficulty",
        "hash",
        "height",
        "isMainChain",
        "merkleroot",
        "nextblockhash",
        "nonce",
        "poolInfo",
        "previousblockhash",
        "reward",
        "size",
        "time",
        "tx",
        "version"
      ])
    })
*/
    /*
    it("should get details for multiple addresses", async () => {
      req.body = {
        addresses: [
          `bchtest:qq89kjkeqz9mngp8kl3dpmu43y2wztdjqu500gn4c4`,
          `bchtest:qzknfggae0av6yvxk77gmyq7syc67yux6sk80haqyr`
        ]
      }

      // Mock the Insight URL for unit tests.
      if (process.env.TEST === "unit") {
        nock(`${process.env.BITCOINCOM_BASEURL}`)
          .get(/addr\/mgps7qxk2Z5ma4mXsviznnet8wx4VvMPFz.)
          .reply(200, mockData.mockAddressDetails)

        nock(`${process.env.BITCOINCOM_BASEURL}`)
          .get(/addr\/mwJnEzXzKkveF2q5Af9jxi9j1zrtWAnPU8.)
          .reply(200, mockData.mockAddressDetails)
      }

      // Call the details API.
      const result = await detailsByHashBulk(req, res)
      //console.log(`result: ${util.inspect(result)}`)

      assert.isArray(result)
      assert.equal(result.length, 2, "2 outputs for 2 inputs")
    })

    it("should throw an error if hash not found", async () => {
      req.body = {
        hashes: [
          `00000000000000645dec6503d3f5eafb0d2537a7a28f181d721dec7c44abcdef`
        ]
      }

      const result = await detailsByHashBulk(req, res)
      console.log(`result: ${util.inspect(result)}`)

      assert.equal(res.statusCode, 400, "HTTP status code 400 expected.")
      assert.include(result.error, "This is not a hash", "Proper error message")
    })
    */
  })

  describe("Block Details By Height", () => {
    // block route handler.
    const detailsByHeight = blockRoute.testableComponents.detailsByHeightSingle

    it("should throw an error for an empty height", async () => {
      req.params.height = ""

      const result = await detailsByHeight(req, res)

      assert.equal(res.statusCode, 400, "HTTP status code 400 expected.")
      assert.include(
        result.error,
        "height must not be empty",
        "Proper error message"
      )
    })

    it("should throw 500 when network issues", async () => {
      // Save the existing RPC URL.
      const savedUrl = process.env.BITCOINCOM_BASEURL
      const savedUrl2 = process.env.RPC_BASEURL

      // Manipulate the URL to cause a 500 network error.
      process.env.BITCOINCOM_BASEURL = "http://fakeurl/api/"
      process.env.RPC_BASEURL = "http://fakeurl/api/"

      req.params.height = "abc123"
      const result = await detailsByHeight(req, res)
      //console.log(`result: ${util.inspect(result)}`)

      // Restore the saved URL.
      process.env.BITCOINCOM_BASEURL = savedUrl
      process.env.RPC_BASEURL = savedUrl2

      assert.equal(res.statusCode, 500, "HTTP status code 500 expected.")
      assert.include(result.error, "ENOTFOUND", "Error message expected")
    })

    it("should throw an error for invalid height", async () => {
      req.params.height = "abc123"

      // Mock the Insight URL for unit tests.
      if (process.env.TEST === "unit") {
        nock(`${process.env.BITCOINCOM_BASEURL}`)
          .get(`/block/${req.params.hash}`)
          .reply(404, { statusText: "Not Found" })
      }

      // Mock the RPC call for unit tests.
      if (process.env.TEST === "unit") {
        nock(`${process.env.RPC_BASEURL}`)
          .post(``)
          .reply(500, { statusText: "Request failed" })
      }

      const result = await detailsByHeight(req, res)
      //console.log(`result: ${util.inspect(result)}`)

      assert.equal(res.statusCode, 500, "HTTP status code 500 expected.")
      assert.include(result.error, "Request failed", "Proper error message")
    })

    it("should GET /detailsByHeight/:height", async () => {
      // Mock the RPC call for unit tests.
      if (process.env.TEST === "unit") {
        nock(`${process.env.RPC_BASEURL}`)
          .post(``)
          .reply(200, { result: mockData.mockBlockHash })
      }

      // Mock the Insight URL for unit tests.
      if (process.env.TEST === "unit") {
        nock(`${process.env.BITCOINCOM_BASEURL}`)
          .get(
            `/block/00000000000000645dec6503d3f5eafb0d2537a7a28f181d721dec7c44154c79`
          )
          .reply(200, mockData.mockBlockDetails)
      }

      req.params.height = 500000

      const result = await detailsByHeight(req, res)
      //console.log(`result: ${util.inspect(result)}`)

      assert.hasAnyKeys(result, [
        "hash",
        "size",
        "height",
        "version",
        "merkleroot",
        "tx",
        "time",
        "nonce",
        "bits",
        "difficulty",
        "chainwork",
        "confirmations",
        "previousblockhash",
        "nextblockhash",
        "reward",
        "isMainChain",
        "poolInfo"
      ])
      assert.isArray(result.tx)
    })
  })
})
