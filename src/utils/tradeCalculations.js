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

  // Ensure price and quantity are numbers
  const tradeValue = Number(price) * Number(quantity);

  if (isNaN(tradeValue)) {
    throw new Error(
      `Invalid trade value: price=${price}, quantity=${quantity}`
    );
  }

  // STT Calculation
  if (equityType === "DELIVERY") {
    stt = chargeRates.sttDelivery * tradeValue;
  } else if (
    equityType === "INTRADAY" &&
    (action === "sell" || action === "both")
  ) {
    stt = chargeRates.sttIntraday * tradeValue;
  } else if (
    equityType === "F&O-FUTURES" &&
    (action === "sell" || action === "both")
  ) {
    stt = chargeRates.sttFuturesSell * tradeValue;
  } else if (
    equityType === "F&O-OPTIONS" &&
    (action === "sell" || action === "both")
  ) {
    stt = chargeRates.sttOptionsSell * tradeValue;
  }

  // Transaction Fee
  if (["DELIVERY", "INTRADAY"].includes(equityType)) {
    transactionFee = chargeRates.transactionFeeDeliveryIntraday * tradeValue;
  } else if (equityType === "F&O-FUTURES") {
    transactionFee = chargeRates.transactionFeeFutures * tradeValue;
  } else if (equityType === "F&O-OPTIONS") {
    transactionFee = chargeRates.transactionFeeOptions * tradeValue;
  }

  // SEBI Charges
  sebiCharges = chargeRates.sebiCharges * tradeValue;

  // Stamp Duty (only for buy orders or both)
  if (action === "buy" || action === "both") {
    if (equityType === "DELIVERY") {
      stampDuty = chargeRates.stampDutyDelivery * tradeValue;
    } else if (["INTRADAY", "F&O-OPTIONS"].includes(equityType)) {
      stampDuty = chargeRates.stampDutyIntradayOptions * tradeValue;
    } else if (equityType === "F&O-FUTURES") {
      stampDuty = chargeRates.stampDutyFutures * tradeValue;
    }
  }

  // GST (18% on brokerage + transaction charges + SEBI charges)
  const gst =
    chargeRates.gstRate * (Number(brokerage) + transactionFee + sebiCharges);

  // DP Charges (only for Equity Delivery sell orders)
  const dpCharges =
    equityType === "DELIVERY" && (action === "sell" || action === "both")
      ? chargeRates.dpCharges
      : 0;

  const totalCharges =
    stt +
    transactionFee +
    sebiCharges +
    stampDuty +
    gst +
    Number(brokerage) +
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
