const ChargeRates = require("../models/ChargeRates");

exports.initializeChargeRates = async () => {
  const existingChargeRates = await ChargeRates.findOne();
  if (!existingChargeRates) {
    const defaultChargeRates = new ChargeRates();
    await defaultChargeRates.save();
    console.log("Default ChargeRates initialized");
  }
};

exports.calculateCharges = async (trade) => {
  const { equityType, action, price, quantity, brokerage } = trade;
  let stt = 0,
    transactionFee = 0,
    sebiCharges = 0,
    stampDuty = 0;

  // Fetch the latest charge rates
  const chargeRates = await ChargeRates.findOne().sort({ createdAt: -1 });

  if (!chargeRates) {
    throw new Error("Charge rates not found. Please initialize charge rates.");
  }

  // STT Calculation
  if (equityType === "DELIVERY") {
    stt = chargeRates.sttDelivery * price * quantity;
  } else if (equityType === "INTRADAY" && action === "sell") {
    stt = chargeRates.sttIntraday * price * quantity;
  } else if (equityType === "F&O-FUTURES" && action === "sell") {
    stt = chargeRates.sttFuturesSell * price * quantity;
  } else if (equityType === "F&O-OPTIONS" && action === "sell") {
    stt = chargeRates.sttOptionsSell * price * quantity;
  }

  // Transaction Fee
  if (["DELIVERY", "INTRADAY"].includes(equityType)) {
    transactionFee =
      chargeRates.transactionFeeDeliveryIntraday * price * quantity;
  } else if (equityType === "F&O-FUTURES") {
    transactionFee = chargeRates.transactionFeeFutures * price * quantity;
  } else if (equityType === "F&O-OPTIONS") {
    transactionFee = chargeRates.transactionFeeOptions * price * quantity;
  }

  // SEBI Charges
  sebiCharges = chargeRates.sebiCharges * price * quantity;

  // Stamp Duty (only for buy orders)
  if (action === "buy") {
    if (equityType === "DELIVERY") {
      stampDuty = chargeRates.stampDutyDelivery * price * quantity;
    } else if (["INTRADAY", "F&O-OPTIONS"].includes(equityType)) {
      stampDuty = chargeRates.stampDutyIntradayOptions * price * quantity;
    } else if (equityType === "F&O-FUTURES") {
      stampDuty = chargeRates.stampDutyFutures * price * quantity;
    }
  }

  // GST (18% on brokerage + transaction charges + SEBI charges)
  const gst = chargeRates.gstRate * (brokerage + transactionFee + sebiCharges);

  // DP Charges (only for Equity Delivery sell orders)
  const dpCharges =
    equityType === "DELIVERY" && action === "sell" ? chargeRates.dpCharges : 0;

  const totalCharges =
    stt +
    transactionFee +
    sebiCharges +
    stampDuty +
    gst +
    brokerage +
    dpCharges;

  return {
    stt,
    transactionFee,
    sebiCharges,
    stampDuty,
    gst,
    dpCharges,
    totalCharges,
  };
};

exports.calculateGrossPnL = ({
  action,
  buyingPrice,
  sellingPrice,
  quantity,
}) => {
  if (action === "buy" || !sellingPrice) {
    return 0; // For buy trades or incomplete sell trades, P&L is not realized yet
  } else {
    return (sellingPrice - (buyingPrice || 0)) * quantity;
  }
};

exports.calculateNetPnL = ({ grossPnL, charges }) => {
  return grossPnL - charges.totalCharges;
};
