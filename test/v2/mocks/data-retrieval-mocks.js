/*
  This library contains mocking data for running unit tests.
*/

"use strict"

const mockConsensusHash = {
  block: 1267863,
  blockhash: "000000000001e7e30c34eaf044ffd0e5bf28eeeaad5fc6b2a6de5cb70befa54c",
  consensushash:
    "476bff1d01a66420a53b65bf72ac46056c91ea32d64a46440306f4a9f1695668"
}

const mockInfo = {
  wormholeversion_int: 10000000,
  wormholeversion: "0.1.0",
  bitcoincoreversion: "0.17.2",
  block: 1267875,
  blocktime: 1542218842,
  blocktransactions: 0,
  totaltransactions: 4355,
  alerts: []
}

const mockProperties = [
  {
    propertyid: 1,
    name: "WHC",
    category: "N/A",
    subcategory: "N/A",
    data:
      "WHC serve as the binding between Bitcoin cash, smart properties and contracts created on the Wormhole.",
    url: "http://www.wormhole.cash",
    precision: 8
  },
  {
    propertyid: 3,
    name: "test_token1",
    category: "test managed token 0",
    subcategory: "test",
    data: "my data",
    url: "www.testmanagedtoken.com",
    precision: 0
  },
  {
    propertyid: 4,
    name: "test_token1",
    category: "test managed token 2",
    subcategory: "test",
    data: "my data",
    url: "www.testmanagedtoken.com",
    precision: 2
  }
]

const mockBalancesForAddress = [
  { propertyid: 1, balance: "3.97384339", reserved: "0.00000000" },
  { propertyid: 314, balance: "1000.00000000", reserved: "0.00000000" },
  { propertyid: 317, balance: "100.00000000", reserved: "0.00000000" },
  { propertyid: 353, balance: "4567.00000000", reserved: "0.00000000" },
  { propertyid: 363, balance: "4567000.00000000", reserved: "0.00000000" },
  { propertyid: 364, balance: "4567000.00000000", reserved: "0.00000000" },
  { propertyid: 367, balance: "4567000.00000000", reserved: "0.00000000" },
  { propertyid: 368, balance: "4566655.00000000", reserved: "0.00000000" },
  { propertyid: 473, balance: "4566655.00000000", reserved: "0.00000000" }
]

module.exports = {
  mockConsensusHash,
  mockInfo,
  mockProperties,
  mockBalancesForAddress
}
