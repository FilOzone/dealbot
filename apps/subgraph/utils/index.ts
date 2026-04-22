// Default proving period length in blocks. Applied when a DataSet enters
// its first NextProvingPeriod. The FWSS contract sets the real value
// on-chain; this is a conservative default for subgraph state init.
//   calibration: MaxProvingPeriod = 240
//   mainnet:     MaxProvingPeriod = 2880
export const MaxProvingPeriod = 240;
