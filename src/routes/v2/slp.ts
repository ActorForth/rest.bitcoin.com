"use strict"

import * as express from "express"
const router = express.Router()
import axios from "axios"
import { IRequestConfig } from "./interfaces/IRequestConfig"
const routeUtils = require("./route-utils")
const logger = require("./logging.js")
const strftime = require("strftime")

// Used to convert error messages to strings, to safely pass to users.
const util = require("util")
util.inspect.defaultOptions = { depth: 5 }

const SLPSDK = require("slp-sdk")
const SLP = new SLPSDK()

// Instantiate SLPJS.
const slp = require("slpjs")
const slpjs = new slp.Slp(SLP)
const utils = slp.Utils

// SLP tx db (LevelDB for caching)
const level = require("level")
const slpTxDb = level("./slp-tx-db")

// Setup JSON RPC
const BitboxHTTP = axios.create({
  baseURL: process.env.RPC_BASEURL
})
const username = process.env.RPC_USERNAME
const password = process.env.RPC_PASSWORD

// Setup REST and TREST URLs used by slpjs
// Dev note: this allows for unit tests to mock the URL.
if (!process.env.REST_URL) process.env.REST_URL = `https://rest.bitcoin.com/v2/`
if (!process.env.TREST_URL)
  process.env.TREST_URL = `https://trest.bitcoin.com/v2/`

router.get("/", root)
router.get("/list", list)
router.get("/list/:tokenId", listSingleToken)
router.post("/list", listBulkToken)
router.get("/balancesForAddress/:address", balancesForAddress)
router.get("/balancesForToken/:tokenId", balancesForTokenSingle)
router.get("/balance/:address/:tokenId", balancesForAddressByTokenID)
router.get("/convert/:address", convertAddressSingle)
router.post("/convert", convertAddressBulk)
router.post("/validateTxid", validateBulk)
router.get("/validateTxid/:txid", validateSingle)
router.get("/txDetails/:txid", txDetails)
router.get("/tokenStats/:tokenId", tokenStats)
router.get("/transactions/:tokenId/:address", txsTokenIdAddressSingle)

if (process.env.NON_JS_FRAMEWORK && process.env.NON_JS_FRAMEWORK === "true") {
  router.get(
    "/createTokenType1/:fundingAddress/:fundingWif/:tokenReceiverAddress/:batonReceiverAddress/:bchChangeReceiverAddress/:decimals/:name/:symbol/:documentUri/:documentHash/:initialTokenQty",
    createTokenType1
  )
  router.get(
    "/mintTokenType1/:fundingAddress/:fundingWif/:tokenReceiverAddress/:batonReceiverAddress/:bchChangeReceiverAddress/:tokenId/:additionalTokenQty",
    mintTokenType1
  )
  router.get(
    "/sendTokenType1/:fundingAddress/:fundingWif/:tokenReceiverAddress/:bchChangeReceiverAddress/:tokenId/:amount",
    sendTokenType1
  )
  router.get(
    "/burnTokenType1/:fundingAddress/:fundingWif/:bchChangeReceiverAddress/:tokenId/:amount",
    burnTokenType1
  )
  router.get(
    "/burnAllTokenType1/:fundingAddress/:fundingWif/:bchChangeReceiverAddress/:tokenId",
    burnAllTokenType1
  )
}

// Retrieve raw transactions details from the full node.
// TODO: move this function to a separate support library.
// TODO: Add unit tests for this function.
async function getRawTransactionsFromNode(txids: string[]) {
  try {
    const {
      BitboxHTTP,
      username,
      password,
      requestConfig
    } = routeUtils.setEnvVars()

    const txPromises = txids.map(async txid => {
      // Check slpTxDb
      try {
        if (slpTxDb.isOpen()) {
          const rawTx = await slpTxDb.get(txid)
          return rawTx
        }
      } catch (err) {}

      requestConfig.data.id = "getrawtransaction"
      requestConfig.data.method = "getrawtransaction"
      requestConfig.data.params = [txid, 0]

      const response = await BitboxHTTP(requestConfig)
      const result = response.data.result

      // Insert to slpTxDb
      try {
        if (slpTxDb.isOpen()) {
          await slpTxDb.put(txid, result)
        }
      } catch (err) {
        // console.log("Error inserting to slpTxDb", err)
      }

      return result
    })

    const results = await axios.all(txPromises)
    return results
  } catch (err) {
    throw err
  }
}

// Create a validator for validating SLP transactions.
function createValidator(network: string, getRawTransactions: any = null): any {
  let tmpSLP: any

  if (network === "mainnet") {
    tmpSLP = new SLPSDK({ restURL: process.env.REST_URL })
  } else {
    tmpSLP = new SLPSDK({ restURL: process.env.TREST_URL })
  }

  const slpValidator: any = new slp.LocalValidator(
    tmpSLP,
    getRawTransactions
      ? getRawTransactions
      : tmpSLP.RawTransactions.getRawTransaction.bind(this)
  )

  return slpValidator
}

// Instantiate the local SLP validator.
const slpValidator = createValidator(
  process.env.NETWORK,
  getRawTransactionsFromNode
)

// Instantiate the bitboxproxy class in SLPJS.
const bitboxproxy = new slp.BitboxNetwork(SLP, slpValidator)

const requestConfig: IRequestConfig = {
  method: "post",
  auth: {
    username: username,
    password: password
  },
  data: {
    jsonrpc: "1.0"
  }
}

function formatTokenOutput(token) {
  token.tokenDetails.id = token.tokenDetails.tokenIdHex
  delete token.tokenDetails.tokenIdHex
  token.tokenDetails.documentHash = token.tokenDetails.documentSha256Hex
  delete token.tokenDetails.documentSha256Hex
  token.tokenDetails.initialTokenQty = parseFloat(
    token.tokenDetails.genesisOrMintQuantity
  )
  delete token.tokenDetails.genesisOrMintQuantity
  delete token.tokenDetails.transactionType
  delete token.tokenDetails.batonVout
  delete token.tokenDetails.sendOutputs

  token.tokenDetails.blockCreated = token.tokenStats.block_created
  token.tokenDetails.blockLastActiveSend =
    token.tokenStats.block_last_active_send
  token.tokenDetails.blockLastActiveMint =
    token.tokenStats.block_last_active_mint
  token.tokenDetails.txnsSinceGenesis =
    token.tokenStats.qty_valid_txns_since_genesis
  token.tokenDetails.validAddresses = token.tokenStats.qty_valid_token_addresses
  token.tokenDetails.totalMinted = parseFloat(token.tokenStats.qty_token_minted)
  token.tokenDetails.totalBurned = parseFloat(token.tokenStats.qty_token_burned)
  token.tokenDetails.circulatingSupply = parseFloat(
    token.tokenStats.qty_token_circulating_supply
  )
  token.tokenDetails.mintingBatonStatus = token.tokenStats.minting_baton_status

  delete token.tokenStats.block_last_active_send
  delete token.tokenStats.block_last_active_mint
  delete token.tokenStats.qty_valid_txns_since_genesis
  delete token.tokenStats.qty_valid_token_addresses
  return token
}

function root(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
) {
  return res.json({ status: "slp" })
}

async function list(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
) {
  try {
    const query = {
      v: 3,
      q: {
        db: ["t"],
        find: {
          $query: {}
        },
        project: { tokenDetails: 1, tokenStats: 1, _id: 0 },
        sort: { "tokenStats.block_created": -1 },
        limit: 10000
      }
    }

    const s = JSON.stringify(query)
    const b64 = Buffer.from(s).toString("base64")
    const url = `${process.env.SLPDB_URL}q/${b64}`

    // Get data from SLPDB.
    const tokenRes = await axios.get(url)

    let formattedTokens: Array<any> = []

    if (tokenRes.data.t.length) {
      tokenRes.data.t.forEach((token: any) => {
        token = formatTokenOutput(token)
        formattedTokens.push(token.tokenDetails)
      })
    }

    res.status(200)
    return res.json(formattedTokens)
  } catch (err) {
    const { msg, status } = routeUtils.decodeError(err)
    if (msg) {
      res.status(status)
      return res.json({ error: msg })
    }
    res.status(500)
    return res.json({ error: `Error in /list: ${err.message}` })
  }
}

async function listSingleToken(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
) {
  try {
    let tokenId = req.params.tokenId

    if (!tokenId || tokenId === "") {
      res.status(400)
      return res.json({ error: "tokenId can not be empty" })
    }

    const t = await lookupToken(tokenId)

    res.status(200)
    return res.json(t)
  } catch (err) {
    const { msg, status } = routeUtils.decodeError(err)
    if (msg) {
      res.status(status)
      return res.json({ error: msg })
    }
    res.status(500)
    return res.json({ error: `Error in /list/:tokenId: ${err.message}` })
  }
}

async function listBulkToken(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
) {
  try {
    let tokenIds = req.body.tokenIds

    // Reject if tokenIds is not an array.
    if (!Array.isArray(tokenIds)) {
      res.status(400)
      return res.json({
        error: "tokenIds needs to be an array. Use GET for single tokenId."
      })
    }

    // Enforce array size rate limits
    if (!routeUtils.validateArraySize(req, tokenIds)) {
      res.status(429) // https://github.com/Bitcoin-com/rest.bitcoin.com/issues/330
      return res.json({
        error: `Array too large.`
      })
    }

    const query = {
      v: 3,
      q: {
        db: ["t"],
        find: {
          "tokenDetails.tokenIdHex": {
            $in: tokenIds
          }
        },
        project: { tokenDetails: 1, tokenStats: 1, _id: 0 },
        sort: { "tokenStats.block_created": -1 },
        limit: 10000
      }
    }

    const s = JSON.stringify(query)
    const b64 = Buffer.from(s).toString("base64")
    const url = `${process.env.SLPDB_URL}q/${b64}`

    const tokenRes = await axios.get(url)

    let formattedTokens: Array<any> = []
    let txids: Array<any> = []

    if (tokenRes.data.t.length) {
      tokenRes.data.t.forEach((token: any) => {
        txids.push(token.tokenDetails.tokenIdHex)
        token = formatTokenOutput(token)
        formattedTokens.push(token.tokenDetails)
      })
    }

    tokenIds.forEach((tokenId: string) => {
      if (!txids.includes(tokenId)) {
        formattedTokens.push({
          id: tokenId,
          valid: false
        })
      }
    })

    res.status(200)
    return res.json(formattedTokens)
  } catch (err) {
    const { msg, status } = routeUtils.decodeError(err)
    if (msg) {
      res.status(status)
      return res.json({ error: msg })
    }
    res.status(500)
    return res.json({ error: `Error in /list/:tokenId: ${err.message}` })
  }
}

async function lookupToken(tokenId) {
  try {
    const query = {
      v: 3,
      q: {
        db: ["t"],
        find: {
          $query: {
            "tokenDetails.tokenIdHex": tokenId
          }
        },
        project: { tokenDetails: 1, tokenStats: 1, _id: 0 },
        limit: 1000
      }
    }

    const s = JSON.stringify(query)
    const b64 = Buffer.from(s).toString("base64")
    const url = `${process.env.SLPDB_URL}q/${b64}`

    const tokenRes = await axios.get(url)

    let formattedTokens: Array<any> = []

    if (tokenRes.data.t.length) {
      tokenRes.data.t.forEach((token: any) => {
        token = formatTokenOutput(token)
        formattedTokens.push(token.tokenDetails)
      })
    }

    let t
    formattedTokens.forEach((token: any) => {
      if (token.id === tokenId) t = token
    })

    // If token could not be found.
    if (t === undefined) {
      t = {
        id: "not found"
      }
    }

    return t
  } catch (err) {
    //console.log(`Error in slp.ts/lookupToken()`)
    throw err
  }
}

// Retrieve token balances for all tokens for a single address.
async function balancesForAddress(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
) {
  try {
    // Validate the input data.
    let address = req.params.address
    if (!address || address === "") {
      res.status(400)
      return res.json({ error: "address can not be empty" })
    }

    // Ensure the input is a valid BCH address.
    try {
      let cash = utils.toCashAddress(address)
    } catch (err) {
      res.status(400)
      return res.json({
        error: `Invalid BCH address. Double check your address is valid: ${address}`
      })
    }

    // Prevent a common user error. Ensure they are using the correct network address.
    let cashAddr = utils.toCashAddress(address)
    const networkIsValid = routeUtils.validateNetwork(cashAddr)
    if (!networkIsValid) {
      res.status(400)
      return res.json({
        error: `Invalid network. Trying to use a testnet address on mainnet, or vice versa.`
      })
    }

    const query = {
      v: 3,
      q: {
        db: ["a"],
        find: {
          address: SLP.Address.toSLPAddress(address),
          token_balance: { $gte: 0 }
        },
        limit: 10000
      }
    }

    const s = JSON.stringify(query)
    const b64 = Buffer.from(s).toString("base64")
    const url = `${process.env.SLPDB_URL}q/${b64}`

    const tokenRes = await axios.get(url)
    // TODO - add decimalCount
    if (tokenRes.data.a.length > 0) {
      tokenRes.data.a = tokenRes.data.a.map(token => {
        token.tokenId = token.tokenDetails.tokenIdHex
        token.balance = parseFloat(token.token_balance)
        token.slpAddress = token.address
        delete token.tokenDetails
        delete token.satoshis_balance
        delete token.token_balance
        delete token._id
        delete token.address
        return token
      })
      return res.json(tokenRes.data.a)
    } else {
      return res.json("No balance for this address")
    }
  } catch (err) {
    // console.log(`Error object: ${util.inspect(err)}`)

    // Decode the error message.
    const { msg, status } = routeUtils.decodeError(err)
    if (msg) {
      res.status(status)
      return res.json({ error: msg })
    }

    res.status(500)
    return res.json({
      error: `Error in /ddress/:address: ${err.message}`
    })
  }
}

// Retrieve token balances for all addresses by single tokenId.
async function balancesForTokenSingle(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
) {
  try {
    // Validate the input data.
    let tokenId = req.params.tokenId
    if (!tokenId || tokenId === "") {
      res.status(400)
      return res.json({ error: "tokenId can not be empty" })
    }

    const query = {
      v: 3,
      q: {
        find: {
          "tokenDetails.tokenIdHex": tokenId,
          token_balance: { $gte: 0 }
        },
        limit: 10000,
        project: { address: 1, satoshis_balance: 1, token_balance: 1, _id: 0 }
      }
    }

    const s = JSON.stringify(query)
    const b64 = Buffer.from(s).toString("base64")
    const url = `${process.env.SLPDB_URL}q/${b64}`

    // Get data from SLPDB.
    const tokenRes = await axios.get(url)
    let resBalances: any[] = tokenRes.data.a.map((addy, index) => {
      delete addy.satoshis_balance
      addy.tokenBalance = parseFloat(addy.token_balance)
      addy.slpAddress = addy.address
      addy.tokenId = tokenId
      delete addy.address
      delete addy.token_balance
      return addy
    })
    return res.json(resBalances)
  } catch (err) {
    // console.log(`Error object: ${util.inspect(err)}`)

    // Decode the error message.
    const { msg, status } = routeUtils.decodeError(err)
    if (msg) {
      res.status(status)
      return res.json({ error: msg })
    }

    res.status(500)
    return res.json({
      error: `Error in /balancesForToken/:tokenId: ${err.message}`
    })
  }
}

// Retrieve token balances for a single token class, for a single address.
async function balancesForAddressByTokenID(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
) {
  try {
    // Validate input data.
    let address: string = req.params.address
    if (!address || address === "") {
      res.status(400)
      return res.json({ error: "address can not be empty" })
    }

    let tokenId: string = req.params.tokenId
    if (!tokenId || tokenId === "") {
      res.status(400)
      return res.json({ error: "tokenId can not be empty" })
    }

    // Ensure the input is a valid BCH address.
    try {
      let cash = utils.toCashAddress(address)
    } catch (err) {
      res.status(400)
      return res.json({
        error: `Invalid BCH address. Double check your address is valid: ${address}`
      })
    }

    // Prevent a common user error. Ensure they are using the correct network address.
    let cashAddr = utils.toCashAddress(address)
    const networkIsValid = routeUtils.validateNetwork(cashAddr)
    if (!networkIsValid) {
      res.status(400)
      return res.json({
        error: `Invalid network. Trying to use a testnet address on mainnet, or vice versa.`
      })
    }

    // Convert input to an simpleledger: address.
    const slpAddr = utils.toSlpAddress(req.params.address)

    const query = {
      v: 3,
      q: {
        db: ["a"],
        find: {
          address: slpAddr,
          token_balance: { $gte: 0 }
        },
        limit: 10000
      }
    }

    const s = JSON.stringify(query)
    const b64 = Buffer.from(s).toString("base64")
    const url = `${process.env.SLPDB_URL}q/${b64}`

    // Get data from SLPDB.
    const tokenRes = await axios.get(url)
    let resVal: any
    res.status(200)
    if (tokenRes.data.a.length > 0) {
      tokenRes.data.a.forEach(token => {
        if (token.tokenDetails.tokenIdHex === tokenId) {
          resVal = {
            tokenId: tokenRes.data.a[0].tokenDetails.tokenIdHex,
            balance: parseFloat(tokenRes.data.a[0].token_balance)
          }
        } else {
          resVal = {
            tokenId: tokenId,
            balance: 0
          }
        }
      })
    } else {
      resVal = {
        tokenId: tokenId,
        balance: 0
      }
    }
    return res.json(resVal)
  } catch (err) {
    //console.log(`Error object: ${util.inspect(err)}`)

    // Decode the error message.
    const { msg, status } = routeUtils.decodeError(err)
    if (msg) {
      res.status(status)
      return res.json({ error: msg })
    }

    res.status(500)
    return res.json({
      error: `Error in /balance/:address/:tokenId: ${err.message}`
    })
  }
}

async function convertAddressSingle(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
) {
  try {
    let address = req.params.address

    // Validate input
    if (!address || address === "") {
      res.status(400)
      return res.json({ error: "address can not be empty" })
    }

    const slpAddr = SLP.Address.toSLPAddress(address)

    const obj: {
      [slpAddress: string]: any
      cashAddress: any
      legacyAddress: any
    } = {
      slpAddress: "",
      cashAddress: "",
      legacyAddress: ""
    }
    obj.slpAddress = slpAddr
    obj.cashAddress = SLP.Address.toCashAddress(slpAddr)
    obj.legacyAddress = SLP.Address.toLegacyAddress(obj.cashAddress)

    res.status(200)
    return res.json(obj)
  } catch (err) {
    const { msg, status } = routeUtils.decodeError(err)
    if (msg) {
      res.status(status)
      return res.json({ error: msg })
    }
    res.status(500)
    return res.json({
      error: `Error in /address/convert/:address: ${err.message}`
    })
  }
}

async function convertAddressBulk(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
) {
  let addresses = req.body.addresses

  // Reject if hashes is not an array.
  if (!Array.isArray(addresses)) {
    res.status(400)
    return res.json({
      error: "addresses needs to be an array. Use GET for single address."
    })
  }

  // Enforce array size rate limits
  if (!routeUtils.validateArraySize(req, addresses)) {
    res.status(429) // https://github.com/Bitcoin-com/rest.bitcoin.com/issues/330
    return res.json({
      error: `Array too large.`
    })
  }

  // Convert each address in the array.
  const convertedAddresses = []
  for (let i = 0; i < addresses.length; i++) {
    const address = addresses[i]

    // Validate input
    if (!address || address === "") {
      res.status(400)
      return res.json({ error: "address can not be empty" })
    }

    const slpAddr = SLP.Address.toSLPAddress(address)

    const obj: {
      [slpAddress: string]: any
      cashAddress: any
      legacyAddress: any
    } = {
      slpAddress: "",
      cashAddress: "",
      legacyAddress: ""
    }
    obj.slpAddress = slpAddr
    obj.cashAddress = SLP.Address.toCashAddress(slpAddr)
    obj.legacyAddress = SLP.Address.toLegacyAddress(obj.cashAddress)

    convertedAddresses.push(obj)
  }

  res.status(200)
  return res.json(convertedAddresses)
}

async function validateBulk(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
) {
  try {
    const txids = req.body.txids

    // Reject if txids is not an array.
    if (!Array.isArray(txids)) {
      res.status(400)
      return res.json({ error: "txids needs to be an array" })
    }

    // Enforce array size rate limits
    if (!routeUtils.validateArraySize(req, txids)) {
      res.status(429) // https://github.com/Bitcoin-com/rest.bitcoin.com/issues/330
      return res.json({
        error: `Array too large.`
      })
    }

    logger.debug(`Executing slp/validate with these txids: `, txids)

    // Validate each txid
    const validatePromises = txids.map(async txid => {
      try {
        // Dev note: must call module.exports to allow stubs in unit tests.
        const isValid = await module.exports.testableComponents.isValidSlpTxid(
          txid
        )

        let tmp: any = {
          txid: txid,
          valid: isValid ? true : false
        }
        return tmp
      } catch (err) {
        //console.log(`err obj: ${util.inspect(err)}`)
        //console.log(`err.response.data: ${util.inspect(err.response.data)}`)
        throw err
      }
    })

    // Filter array to only valid txid results
    const validateResults = await axios.all(validatePromises)
    const validTxids = validateResults.filter(result => result)

    res.status(200)
    return res.json(validTxids)
  } catch (err) {
    // Attempt to decode the error message.
    const { msg, status } = routeUtils.decodeError(err)
    if (msg) {
      res.status(status)
      return res.json({ error: msg })
    }

    res.status(500)
    return res.json({ error: util.inspect(err) })
  }
}

async function validateSingle(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
) {
  try {
    const txid = req.params.txid

    // Validate input
    if (!txid || txid === "") {
      res.status(400)
      return res.json({ error: "txid can not be empty" })
    }

    logger.debug(`Executing slp/validate/:txid with this txid: `, txid)

    // Validate txid
    // Dev note: must call module.exports to allow stubs in unit tests.
    const isValid = await module.exports.testableComponents.isValidSlpTxid(txid)

    let tmp: any = {
      txid: txid,
      valid: isValid ? true : false
    }

    res.status(200)
    return res.json(tmp)
  } catch (err) {
    // Attempt to decode the error message.
    const { msg, status } = routeUtils.decodeError(err)
    if (msg) {
      res.status(status)
      return res.json({ error: msg })
    }

    res.status(500)
    return res.json({ error: util.inspect(err) })
  }
}

// Returns a Boolean if the input TXID is a valid SLP TXID.
async function isValidSlpTxid(txid: string): Promise<boolean> {
  const isValid = await slpValidator.isValidSlpTxid(txid)
  return isValid
}

// Below are functions which are enabled for teams not using our javascript SDKs which still need to create txs
// These should never be enabled on our public REST API

async function createTokenType1(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
) {
  let fundingAddress = req.params.fundingAddress
  if (!fundingAddress || fundingAddress === "") {
    res.status(400)
    return res.json({ error: "fundingAddress can not be empty" })
  }

  let fundingWif = req.params.fundingWif
  if (!fundingWif || fundingWif === "") {
    res.status(400)
    return res.json({ error: "fundingWif can not be empty" })
  }

  let tokenReceiverAddress = req.params.tokenReceiverAddress
  if (!tokenReceiverAddress || tokenReceiverAddress === "") {
    res.status(400)
    return res.json({ error: "tokenReceiverAddress can not be empty" })
  }

  let batonReceiverAddress = req.params.batonReceiverAddress
  if (!batonReceiverAddress || batonReceiverAddress === "") {
    res.status(400)
    return res.json({ error: "batonReceiverAddress can not be empty" })
  }

  let bchChangeReceiverAddress = req.params.bchChangeReceiverAddress
  if (!bchChangeReceiverAddress || bchChangeReceiverAddress === "") {
    res.status(400)
    return res.json({ error: "bchChangeReceiverAddress can not be empty" })
  }

  let decimals = req.params.decimals
  if (!decimals || decimals === "") {
    res.status(400)
    return res.json({ error: "decimals can not be empty" })
  }

  let name = req.params.name
  if (!name || name === "") {
    res.status(400)
    return res.json({ error: "name can not be empty" })
  }

  let symbol = req.params.symbol
  if (!symbol || symbol === "") {
    res.status(400)
    return res.json({ error: "symbol can not be empty" })
  }

  let documentUri = req.params.documentUri
  if (!documentUri || documentUri === "") {
    res.status(400)
    return res.json({ error: "documentUri can not be empty" })
  }

  let documentHash = req.params.documentHash
  if (!documentHash || documentHash === "") {
    res.status(400)
    return res.json({ error: "documentHash can not be empty" })
  }

  let initialTokenQty = req.params.initialTokenQty
  if (!initialTokenQty || initialTokenQty === "") {
    res.status(400)
    return res.json({ error: "initialTokenQty can not be empty" })
  }

  let token = await SLP.TokenType1.create({
    fundingAddress: fundingAddress,
    fundingWif: fundingWif,
    tokenReceiverAddress: tokenReceiverAddress,
    batonReceiverAddress: batonReceiverAddress,
    bchChangeReceiverAddress: bchChangeReceiverAddress,
    decimals: decimals,
    name: name,
    symbol: symbol,
    documentUri: documentUri,
    documentHash: documentHash,
    initialTokenQty: initialTokenQty
  })

  res.status(200)
  return res.json(token)
}

async function mintTokenType1(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
) {
  let fundingAddress = req.params.fundingAddress
  if (!fundingAddress || fundingAddress === "") {
    res.status(400)
    return res.json({ error: "fundingAddress can not be empty" })
  }

  let fundingWif = req.params.fundingWif
  if (!fundingWif || fundingWif === "") {
    res.status(400)
    return res.json({ error: "fundingWif can not be empty" })
  }

  let tokenReceiverAddress = req.params.tokenReceiverAddress
  if (!tokenReceiverAddress || tokenReceiverAddress === "") {
    res.status(400)
    return res.json({ error: "tokenReceiverAddress can not be empty" })
  }

  let batonReceiverAddress = req.params.batonReceiverAddress
  if (!batonReceiverAddress || batonReceiverAddress === "") {
    res.status(400)
    return res.json({ error: "batonReceiverAddress can not be empty" })
  }

  let bchChangeReceiverAddress = req.params.bchChangeReceiverAddress
  if (!bchChangeReceiverAddress || bchChangeReceiverAddress === "") {
    res.status(400)
    return res.json({ error: "bchChangeReceiverAddress can not be empty" })
  }

  let tokenId = req.params.tokenId
  if (!tokenId || tokenId === "") {
    res.status(400)
    return res.json({ error: "tokenId can not be empty" })
  }

  let additionalTokenQty = req.params.additionalTokenQty
  if (!additionalTokenQty || additionalTokenQty === "") {
    res.status(400)
    return res.json({ error: "additionalTokenQty can not be empty" })
  }

  let mint = await SLP.TokenType1.mint({
    fundingAddress: fundingAddress,
    fundingWif: fundingWif,
    tokenReceiverAddress: tokenReceiverAddress,
    batonReceiverAddress: batonReceiverAddress,
    bchChangeReceiverAddress: bchChangeReceiverAddress,
    tokenId: tokenId,
    additionalTokenQty: additionalTokenQty
  })

  res.status(200)
  return res.json(mint)
}

async function sendTokenType1(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
) {
  let fundingAddress = req.params.fundingAddress
  if (!fundingAddress || fundingAddress === "") {
    res.status(400)
    return res.json({ error: "fundingAddress can not be empty" })
  }

  let fundingWif = req.params.fundingWif
  if (!fundingWif || fundingWif === "") {
    res.status(400)
    return res.json({ error: "fundingWif can not be empty" })
  }

  let tokenReceiverAddress = req.params.tokenReceiverAddress
  if (!tokenReceiverAddress || tokenReceiverAddress === "") {
    res.status(400)
    return res.json({ error: "tokenReceiverAddress can not be empty" })
  }

  let bchChangeReceiverAddress = req.params.bchChangeReceiverAddress
  if (!bchChangeReceiverAddress || bchChangeReceiverAddress === "") {
    res.status(400)
    return res.json({ error: "bchChangeReceiverAddress can not be empty" })
  }

  let tokenId = req.params.tokenId
  if (!tokenId || tokenId === "") {
    res.status(400)
    return res.json({ error: "tokenId can not be empty" })
  }

  let amount = req.params.amount
  if (!amount || amount === "") {
    res.status(400)
    return res.json({ error: "amount can not be empty" })
  }
  let send = await SLP.TokenType1.send({
    fundingAddress: fundingAddress,
    fundingWif: fundingWif,
    tokenReceiverAddress: tokenReceiverAddress,
    bchChangeReceiverAddress: bchChangeReceiverAddress,
    tokenId: tokenId,
    amount: amount
  })

  res.status(200)
  return res.json(send)
}

async function burnTokenType1(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
) {
  let fundingAddress = req.params.fundingAddress
  if (!fundingAddress || fundingAddress === "") {
    res.status(400)
    return res.json({ error: "fundingAddress can not be empty" })
  }

  let fundingWif = req.params.fundingWif
  if (!fundingWif || fundingWif === "") {
    res.status(400)
    return res.json({ error: "fundingWif can not be empty" })
  }

  let bchChangeReceiverAddress = req.params.bchChangeReceiverAddress
  if (!bchChangeReceiverAddress || bchChangeReceiverAddress === "") {
    res.status(400)
    return res.json({ error: "bchChangeReceiverAddress can not be empty" })
  }

  let tokenId = req.params.tokenId
  if (!tokenId || tokenId === "") {
    res.status(400)
    return res.json({ error: "tokenId can not be empty" })
  }

  let amount = req.params.amount
  if (!amount || amount === "") {
    res.status(400)
    return res.json({ error: "amount can not be empty" })
  }

  let burn = await SLP.TokenType1.burn({
    fundingAddress: fundingAddress,
    fundingWif: fundingWif,
    tokenId: tokenId,
    amount: amount,
    bchChangeReceiverAddress: bchChangeReceiverAddress
  })

  res.status(200)
  return res.json(burn)
}

async function burnAllTokenType1(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
) {
  let fundingAddress = req.params.fundingAddress
  if (!fundingAddress || fundingAddress === "") {
    res.status(400)
    return res.json({ error: "fundingAddress can not be empty" })
  }

  let fundingWif = req.params.fundingWif
  if (!fundingWif || fundingWif === "") {
    res.status(400)
    return res.json({ error: "fundingWif can not be empty" })
  }

  let bchChangeReceiverAddress = req.params.bchChangeReceiverAddress
  if (!bchChangeReceiverAddress || bchChangeReceiverAddress === "") {
    res.status(400)
    return res.json({ error: "bchChangeReceiverAddress can not be empty" })
  }

  let tokenId = req.params.tokenId
  if (!tokenId || tokenId === "") {
    res.status(400)
    return res.json({ error: "tokenId can not be empty" })
  }

  let burnAll = await SLP.TokenType1.burnAll({
    fundingAddress: fundingAddress,
    fundingWif: fundingWif,
    tokenId: tokenId,
    bchChangeReceiverAddress: bchChangeReceiverAddress
  })

  res.status(200)
  return res.json(burnAll)
}

async function txDetails(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
) {
  try {
    // Validate input parameter
    const txid = req.params.txid
    if (!txid || txid === "") {
      res.status(400)
      return res.json({ error: "txid can not be empty" })
    }

    if (txid.length !== 64) {
      res.status(400)
      return res.json({ error: "This is not a txid" })
    }

    let tmpSLP
    if (process.env.NETWORK === "testnet")
      tmpSLP = new SLPSDK({ restURL: process.env.TREST_URL })
    else tmpSLP = new SLPSDK({ restURL: process.env.REST_URL })

    const tmpbitboxNetwork = new slp.BitboxNetwork(tmpSLP, slpValidator)

    // Get TX info + token info
    const result = await tmpbitboxNetwork.getTransactionDetails(txid)

    res.status(200)
    return res.json(result)
  } catch (err) {
    //console.log(`Error in tokenTransfer(): `, err)

    // Attempt to decode the error message.
    const { msg, status } = routeUtils.decodeError(err)
    if (msg) {
      res.status(status)
      return res.json({ error: msg })
    }

    // Handle corner case of mis-typted txid
    if (err.error.indexOf("Not found") > -1) {
      res.status(400)
      return res.json({ error: "TXID not found" })
    }

    res.status(500)
    return res.json({ error: util.inspect(err) })
  }
}

async function tokenStats(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
) {
  let tokenId: string = req.params.tokenId
  if (!tokenId || tokenId === "") {
    res.status(400)
    return res.json({ error: "tokenId can not be empty" })
  }

  try {
    const query = {
      v: 3,
      q: {
        db: ["t"],
        find: {
          $query: {
            "tokenDetails.tokenIdHex": tokenId
          }
        },
        project: { tokenDetails: 1, tokenStats: 1, _id: 0 },
        limit: 10
      }
    }

    const s = JSON.stringify(query)
    const b64 = Buffer.from(s).toString("base64")
    const url = `${process.env.SLPDB_URL}q/${b64}`

    // Get data from BitDB.
    const tokenRes = await axios.get(url)

    let formattedTokens: Array<any> = []

    if (tokenRes.data.t.length) {
      tokenRes.data.t.forEach((token: any) => {
        token = formatTokenOutput(token)
        formattedTokens.push(token.tokenDetails)
      })
    }

    res.status(200)
    return res.json(formattedTokens[0])
  } catch (err) {
    const { msg, status } = routeUtils.decodeError(err)
    if (msg) {
      res.status(status)
      return res.json({ error: msg })
    }
    res.status(500)
    return res.json({ error: `Error in /tokenStats: ${err.message}` })
  }
}

// Retrieve transactions by tokenId and address.
async function txsTokenIdAddressSingle(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
) {
  try {
    // Validate the input data.
    let tokenId = req.params.tokenId
    if (!tokenId || tokenId === "") {
      res.status(400)
      return res.json({ error: "tokenId can not be empty" })
    }

    let address = req.params.address
    if (!address || address === "") {
      res.status(400)
      return res.json({ error: "address can not be empty" })
    }

    const query = {
      v: 3,
      q: {
        find: {
          db: ["c", "u"],
          $query: {
            $or: [
              {
                "in.e.a": address
              },
              {
                "out.e.a": address
              }
            ],
            "slp.detail.tokenIdHex": tokenId
          },
          $orderby: {
            "blk.i": -1
          }
        },
        limit: 100
      },
      r: {
        f: "[.[] | { txid: .tx.h, tokenDetails: .slp } ]"
      }
    }

    const s = JSON.stringify(query)
    const b64 = Buffer.from(s).toString("base64")
    const url = `${process.env.SLPDB_URL}q/${b64}`

    // Get data from SLPDB.
    const tokenRes = await axios.get(url)
    return res.json(tokenRes.data.c)
  } catch (err) {
    //console.log(`Error object: ${util.inspect(err)}`)

    // Decode the error message.
    const { msg, status } = routeUtils.decodeError(err)
    if (msg) {
      res.status(status)
      return res.json({ error: msg })
    }

    res.status(500)
    return res.json({
      error: `Error in /transactions/:tokenId/:address: ${err.message}`
    })
  }
}

module.exports = {
  router,
  testableComponents: {
    root,
    list,
    listSingleToken,
    listBulkToken,
    balancesForAddress,
    balancesForAddressByTokenID,
    convertAddressSingle,
    convertAddressBulk,
    validateBulk,
    isValidSlpTxid,
    createTokenType1,
    mintTokenType1,
    sendTokenType1,
    burnTokenType1,
    burnAllTokenType1,
    txDetails,
    tokenStats,
    balancesForTokenSingle,
    txsTokenIdAddressSingle
  }
}
