/* QR payloads are parsed, normalized, and grouped for scanner, UI, and run logic. */

function cleanText(v) {
  return String(v || "").trim();
}

function isVersion(value, expectedVersion) {
  return cleanText(value).toUpperCase() === expectedVersion;
}

function hasUnknownWord(values) {
  return values.some(value => /\bUNKNOWN\b/i.test(cleanText(value)));
}

function assertNoEmptyValues(qrLabel, values) {
  if (values.some(value => !cleanText(value))) {
    throw new Error(`${qrLabel} QR contains empty values.`);
  }
}

function assertNoUnknownWords(qrLabel, values) {
  if (hasUnknownWord(values)) {
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

  assertNoUnknownWords("Chiller", parts);

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

  assertNoUnknownWords("PV", parts);

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

export function getLaneType(description) {
  const d = cleanText(description).toLowerCase();

  if (d === "evaporator") return "EVAPORATOR";
  if (d === "condenser") return "CONDENSER";
  if (d === "oil separator") return "OIL_SEPARATOR";
  if (d === "economizer") return "ECONOMIZER";

  return "FABRICATION";
}

export function parseFabricationItemQR(text) {
  const raw = cleanText(text);
  const parts = raw.split(";").map(s => s.trim());

  if (parts.length !== 8) {
    throw new Error("Invalid item QR format.");
  }

  const [
    version,
    projectName,
    item,
    partNumber,
    materialNumber,
    serialNumber,
    model,
    refrigerant
  ] = parts;

  if (
    !version ||
    !projectName ||
    !item ||
    !partNumber ||
    !materialNumber ||
    !serialNumber ||
    !model ||
    !refrigerant
  ) {
    throw new Error("Item QR contains empty values.");
  }

  if (!isVersion(version, "D4")) {
    throw new Error("Invalid item QR version. Expected D4.");
  }

  assertNoUnknownWords("Item", parts);

  return {
    qrKind: "FABRICATION_ITEM",
    version,
    projectName,
    item,
    description: item,
    partNumber,
    materialNumber,
    serialNumber,
    chillerSerialNumber: serialNumber,
    model,
    refrigerant,
    itemID: partNumber,
    laneType: getLaneType(item)
  };
}

export function groupItemsByChiller(items) {
  const map = new Map();

  for (const item of items) {
    const key = item.chillerSerialNumber;
    if (!map.has(key)) {
      map.set(key, {
        chillerSerialNumber: item.chillerSerialNumber,
        projectName: item.projectName,
        items: []
      });
    }
    map.get(key).items.push(item);
  }

  return Array.from(map.values());
}

export function buildLaneSummary(items) {
  const summary = {
    EVAPORATOR: 0,
    CONDENSER: 0,
    OIL_SEPARATOR: 0,
    ECONOMIZER: 0,
    FABRICATION: 0
  };

  for (const item of items) {
    const lane = item.laneType || "FABRICATION";
    if (summary[lane] == null) summary[lane] = 0;
    summary[lane] += 1;
  }

  return summary;
}
