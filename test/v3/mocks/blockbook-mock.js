/*
  Mock data for unit testing Blockbook services library.
*/

const balance = {
  page: 1,
  totalPages: 1,
  itemsOnPage: 1000,
  address: "bitcoincash:qp3sn6vlwz28ntmf3wmyra7jqttfx7z6zgtkygjhc7",
  balance: "1000",
  totalReceived: "1000",
  totalSent: "0",
  unconfirmedBalance: "0",
  unconfirmedTxs: 0,
  txs: 1,
  txids: ["6181c669614fa18039a19b23eb06806bfece1f7514ab457c3bb82a40fe171a6d"]
}

module.exports = {
  balance
}
