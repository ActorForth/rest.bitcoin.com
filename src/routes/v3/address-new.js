/*
  Definitions for v3 Address routes.
  See specification doc in /docs/v3/api-spec.md
*/

const util = require("util")

const BITBOX = require("slp-sdk")
const bitbox = new BITBOX()

const express = require("express")
const router = express.Router()

const axios = require("axios")
const wlogger = require("../../util/winston-logging")

// Local libraries.
const Blockbook = require("./services/blockbook")
const blockbook = new Blockbook()
const Ninsight = require("./services/ninsight")
const ninsight = new Ninsight()
const RouteUtils = require("../../util/route-utils")
const routeUtils = new RouteUtils()

// A local global reference to 'this' of the instance of this Class.
let _this

class Address {
  constructor() {
    _this = this

    // Encapsulate global libraries into the instance of this Class.
    // Makes it easier to mock for unit tests.
    _this.bitbox = bitbox
    _this.axios = axios
    _this.blockbook = blockbook
    _this.ninsight = ninsight
    _this.routeUtils = routeUtils

    // Select the indexer to use. Default to Ninsight.
    _this.indexer = process.env.INDEXER ? process.env.INDEXER : "NINSIGHT"

    _this.router = router
    _this.router.get("/", this.root)
    _this.router.post("/balance", this.balance)
    _this.router.post("/utxo", this.utxo)
  }

  root(req, res, next) {
    return res.json({ status: "address-v3" })
  }

  // Get the BCH balance for an array of addresses.
  // curl -X POST "http://localhost:3000/v3-alpha/address/balance" -H "accept: application/json" -H "Content-Type: application/json" -d "{\"addresses\":[\"bitcoincash:qp3sn6vlwz28ntmf3wmyra7jqttfx7z6zgtkygjhc7\",\"bitcoincash:qpdh9s677ya8tnx7zdhfrn8qfyvy22wj4qa7nwqa5v\"]}"
  async balance(req, res, next) {
    try {
      const addresses = req.body.addresses

      // Reject if addresses is not an array.
      if (!Array.isArray(addresses)) {
        res.status(400)
        return res.json({
          error: "addresses needs to be an array."
        })
      }

      // Enforce array size rate limits
      if (!routeUtils.validateArraySize(req, addresses)) {
        res.status(429) // https://github.com/Bitcoin-com/rest.bitcoin.com/issues/330
        return res.json({
          error: "Array too large."
        })
      }

      // Validate each element in the address array.
      for (let i = 0; i < addresses.length; i++) {
        const thisAddress = addresses[i]
        // Ensure the input is a valid BCH address.
        try {
          _this.bitbox.Address.toLegacyAddress(thisAddress)
        } catch (err) {
          res.status(400)
          return res.json({
            error: `Invalid BCH address. Double check your address is valid: ${thisAddress}`
          })
        }
        // Prevent a common user error. Ensure they are using the correct network address.
        const networkIsValid = _this.routeUtils.validateNetwork(
          thisAddress
        )
        if (!networkIsValid) {
          res.status(400)
          return res.json({
            error: `Invalid network for address ${thisAddress}. Trying to use a testnet address on mainnet, or vice versa.`
          })
        }
      }

      const balances = addresses.map(async (address, index) => {
        // Get the data from the selected indexer.
        if (_this.indexer === "BLOCKBOOK")
          return _this.blockbook.balance(address)
        return _this.ninsight.balance(address)
      })

      // Wait for all promises to resolve.
      const result = await Promise.all(balances)
      // console.log(`result: ${JSON.stringify(result, null, 2)}`)

      res.status(200)
      return res.json(result)
    } catch (err) {
      // console.log(`err: `, err)
      // console.log(`err: ${JSON.stringify(err, null, 2)}`)

      // Attempt to decode the error message.
      const { msg, status } = _this.routeUtils.decodeError(err)
      if (msg) {
        console.log("Attempt to decode the error message")
        res.status(status)
        return res.json({ error: msg })
      }

      // If error could not be decoded.
      wlogger.error("Error in address-new.js/balance().", err)
      res.status(500)
      return res.json({ error: util.inspect(err) })
    }
  }

  // Get UTXOs for an array of addresses.
  // curl -X POST "http://localhost:3000/v3-alpha/address/utxo" -H "accept: application/json" -H "Content-Type: application/json" -d "{\"addresses\":[\"bitcoincash:qp3sn6vlwz28ntmf3wmyra7jqttfx7z6zgtkygjhc7\",\"bitcoincash:qpdh9s677ya8tnx7zdhfrn8qfyvy22wj4qa7nwqa5v\"]}"
  async utxo(req, res, next) {
    try {
      const addresses = req.body.addresses

      // Reject if addresses is not an array.
      if (!Array.isArray(addresses)) {
        res.status(400)
        return res.json({
          error: "addresses needs to be an array."
        })
      }

      // Enforce array size rate limits
      if (!routeUtils.validateArraySize(req, addresses)) {
        res.status(429) // https://github.com/Bitcoin-com/rest.bitcoin.com/issues/330
        return res.json({
          error: "Array too large."
        })
      }

      // Validate each element in the address array.
      for (let i = 0; i < addresses.length; i++) {
        const thisAddress = addresses[i]
        // Ensure the input is a valid BCH address.
        try {
          _this.bitbox.Address.toLegacyAddress(thisAddress)
        } catch (err) {
          res.status(400)
          return res.json({
            error: `Invalid BCH address. Double check your address is valid: ${thisAddress}`
          })
        }

        // Prevent a common user error. Ensure they are using the correct network address.
        const networkIsValid = _this.routeUtils.validateNetwork(
          thisAddress
        )
        if (!networkIsValid) {
          res.status(400)
          return res.json({
            error: `Invalid network for address ${thisAddress}. Trying to use a testnet address on mainnet, or vice versa.`
          })
        }
      }

      const utxos = addresses.map(async (address, index) => {
        // Get the data from the selected indexer.
        if (_this.indexer === "BLOCKBOOK") return _this.blockbook.utxo(address)
        return _this.ninsight.utxo(address)
      })

      // Wait for all promises to resolve.
      const result = await Promise.all(utxos)
      // console.log(`result: ${JSON.stringify(result, null, 2)}`)

      res.status(200)
      return res.json(result)
    } catch (err) {
      // console.log(`err: `, err)
      // console.log(`err: ${JSON.stringify(err, null, 2)}`)

      // Attempt to decode the error message.
      const { msg, status } = _this.routeUtils.decodeError(err)
      if (msg) {
        res.status(status)
        return res.json({ error: msg })
      }

      // If error could not be decoded.
      wlogger.error("Error in address-new.js/utxo().", err)
      res.status(500)
      return res.json({ error: util.inspect(err) })
    }
  }
}

module.exports = Address
