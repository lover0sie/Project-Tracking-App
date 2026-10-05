/* QR payloads are parsed, normalized, and grouped for scanner, UI, and run logic. */

function cleanText(v) {
  return String(v || "").trim();
}

function isVersion(value, expectedVersion) {
  return cleanText(value).toUpperCase() === expectedVersion;
}

function hasUnknownWord(values, ignoredIndexes = []) {
  const ignored = new Set(ignoredIndexes);
  return values.some((value, index) => (
    !ignored.has(index) && /\bUNKNOWN\b/i.test(cleanText(value))
  ));
}

function assertNoEmptyValues(qrLabel, values) {
  if (values.some(value => !cleanText(value))) {
    throw new Error(`${qrLabel} QR contains empty values.`);
  }
}

function assertNoUnknownWords(qrLabel, values, ignoredIndexes = []) {
  if (hasUnknownWord(values, ignoredIndexes)) {
    throw new Error(`${qrLabel} QR contains UNKNOWN value.`);
  }
}

export function parseEmployeeQR(text) {
  const raw = cleanText(text);
  const parts = raw.split(";").map(s => s.trim());

  if (parts.length !== 4 || parts[0] !== "EMP") {
    throw new Error("Invalid employee QR format.");
  }

  return {
    employeeNumber: parts[1],
    employeeName: parts[2],
    station: parts[3]
  };
}

export function parseChillerQR(text) {
  const raw = cleanText(text);
  const parts = raw.split(";").map(s => s.trim());
  if (parts.length !== 8) return null;

  const [version, projectName, description, materialNumber, chillerSerialNumber, model, coolingType, refrigerant] = parts;

  assertNoEmptyValues("Chiller", parts);

  if (!isVersion(version, "D1")) {
    throw new Error("Invalid Chiller QR version.");
  }

  assertNoUnknownWords("Chiller", parts, [3]);

  return {
    qrKind: "CHILLER",
    version,
    projectName,
    description,
    materialNumber,
    chillerSerialNumber,
    model,
    coolingType,
    refrigerant
  };
}

export function parsePvQR(text) {
  const raw = cleanText(text);
  const parts = raw.split(";").map(s => s.trim());
  if (parts.length !== 9) return null;

  const [version, projectName, partNumber, materialNumber, chillerSerialNumber, pvSerialNumber, vesselType, model, refrigerant] = parts;

  assertNoEmptyValues("PV", parts);

  if (!isVersion(version, "D3")) {
    throw new Error("Invalid PV QR version.");
  }

  assertNoUnknownWords("PV", parts, [3]);

  return {
    qrKind: "PV",
    version,
    projectName,
    partNumber,
    materialNumber,
    chillerSerialNumber,
    pvSerialNumber,
    vesselType,
    model,
    refrigerant
  };
}

export function parseFabricationProjectQR(text) {
  let source = null;

  try {
    source = parsePvQR(text) || parseChillerQR(text);
  } catch (err) {
    throw err;
  }

  if (!source) {
    throw new Error("Invalid fabrication QR format. Scan PV or Chiller QR.");
  }

  const sourceQrKind = source.qrKind;
  const chillerSerialNumber = source.chillerSerialNumber;
  const description = sourceQrKind === "PV"
    ? source.partNumber
    : source.description;

  return {
    ...source,
    qrKind: "FABRICATION_ITEM",
    sourceQrKind,
    serialNumber: chillerSerialNumber,
    chillerSerialNumber,
    itemID: chillerSerialNumber,
    item: "Fabrication item",
    description,
    partNumber: source.partNumber || source.description || "",
    type: source.vesselType || source.coolingType || "",
    laneType: "FABRICATION"
  };
}
