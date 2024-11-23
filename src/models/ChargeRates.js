const mongoose = require("mongoose");

const chargeRatesSchema = new mongoose.Schema(
  {
    sttDelivery: { type: Number, default: 0.001 },
    sttIntraday: { type: Number, default: 0.00025 },
    sttFuturesSell: { type: Number, default: 0.000125 },
    sttOptionsSell: { type: Number, default: 0.000625 },
    transactionFeeDeliveryIntraday: { type: Number, default: 0.0000322 },
    transactionFeeFutures: { type: Number, default: 0.0000188 },
    transactionFeeOptions: { type: Number, default: 0.000495 },
    sebiCharges: { type: Number, default: 0.000001 },
    stampDutyDelivery: { type: Number, default: 0.00015 },
    stampDutyIntradayOptions: { type: Number, default: 0.00003 },
    stampDutyFutures: { type: Number, default: 0.00002 },
    gstRate: { type: Number, default: 0.18 },
    dpCharges: { type: Number, default: 13 },
  },
  { timestamps: true }
);

const ChargeRates = mongoose.model("ChargeRates", chargeRatesSchema);

module.exports = ChargeRates;
