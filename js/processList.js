// Vessel -> processes
export const PROCESS_BY_PV = {
  "EVAPORATOR": [
    "6A - Hole bevelling",
    "6B - Fitting flange and piping",
    "7 - Connector welding",
    "8A - Internal plate assembly",
    "8B - Fitting internal plate",
    "8C - GMAW C&B",
    "9A - Distribution box assembly",
    "9B - Fitting and welding distribution box",
    "10 - Tube support, bush fitting, and tube sheet fitting",
    "11 - Tubesheet welding",
    "12 - Bracket and attachment welding, copper tube brazing",
    "13 - Unit side plate and base welding",
    "14A - Tube slotting",
    "14B - Tube expansion",
    "14C - Shell body slotting",
    "15 - Primer painting",
    "16 - Pneumatic testing",
    "17 - Hydrostatic testing",
    "18, 19 - Primer painting (weld seam) and top coat painting"
  ],

   "CONDENSER": [
    "6A - Hole bevelling",
    "6B - Fitting flange and piping",
    "7 - Connector welding",
    "8A - Internal plate assembly",
    "8B - Fitting internal plate",
    "8C - GMAW C&B",
    "10 - Tube support, bush fitting, and tube sheet fitting",
    "11 - Tubesheet welding",
    "12 - Bracket and attachment welding, copper tube brazing",
    "13 - Unit side plate and base welding",
    "14A - Tube slotting",
    "14B - Tube expansion",
    "14C - Shell body slotting",
    "15 - Primer painting",
    "16 - Pneumatic testing",
    "17 - Hydrostatic testing",
    "18, 19 - Primer painting (weld seam) and top coat painting"
  ],

  "OIL SEPARATOR":[
    "6, 7 - Hole bevelling and connector welding",
    "8, 9, 10, 11 - Internal plate, distribution box, tube support and bush fitting and welding",
    "12 - Bracket and attachment fitting and welding",
    "15 - Primer painting",
    "16 - Pneumatic testing",
    "19 - Top coat painting"
  ],

  "ECONOMIZER":[
    "6, 7 - Hole bevelling and connector welding",
    "8, 9, 10, 11 - Internal plate, distribution box, tube support and bush fitting and welding",
    "12 - Bracket and attachment fitting and welding",
    "15 - Primer painting",
    "16 - Pneumatic testing",
    "19 - Top coat painting"
  ],

   "WATER COVER COND SIDE A AND B":[
    "6 - Hole bevelling",
    "7 - Connector welding",
  ],

  "WATER COVER EVAP SIDE A AND B":[
    "6 - Hole bevelling",
    "7 - Connector welding",
  ],
}

// CHILLER -> processes
export const PROCESS_BY_CHILLER = {
  "AIR-COOLED": [
    "Piping shop",
    "A1 - Coil assembly (Fan assembly)",
    "A2 - Coil assembly (Fan wiring)",
    "B1 - High-side assembly (Partition coil assembly)",
    "B2 - High-side assembly (Compressor and penta post assembly)",
    "B3 - High-side assembly (Evaporator assembly)",
    "B4 - High-side assembly (Piping assembly)",
    "B5 - High-side assembly (Wiring base)",
    "C1 - Brazing assembly (Brazing base)",
    "C2 - Brazing assembly (Brazing coil)",
    "D1 - Final assembly (Hoist coil onto base)",
    "D2 - Final assembly (Final brazing)",
    "D3 - Final assembly (Accessories assembly)",
    "D4 - Final assembly (Preparation for wiring and terminal box)",
    "D5 - Final assembly (Wiring control box)",
    "D6 - Final assembly (Panel installation)",
    "D7 - Final assembly (Pipe insulation)",
    "G - Piping insulation",
    "H1 - Checking item, wipe, sanding, polish, paste tape and plastic, and spray paint",
    "H2 - Remove tape and plastic, attach acrylic, organize wires, attach cap, and paste unit stickers",
    "H3 - Wrap the unit"
  ],
  "WATER-COOLED": [
    "Piping shop",
    "Steel pipe sub-assembly (Fitting)",
    "Steel pipe sub-assembly (Welding)",
    "C - Major components assembly",
    "D - Steel pipe welding",
    "E - Copper pipe brazing",
    "F - Control box and wiring",
    "G - Piping insulation",
    "H1 - Checking item, wipe, sanding, polish, paste tape and plastic, and spray paint",
    "H2 - Remove tape and plastic, attach acrylic, organize wires, attach cap, and paste unit stickers",
    "H3 - Wrap the unit"
  ]
};

export const INSULATION_STATIONS = ["Insulation AB"];

export const INSULATION_PROCESS_COMPRESSOR = "A - Insulation compressor";
export const INSULATION_PROCESS_COMPONENT = "B - Insulation evaporator/condenser and economizer/oil separator";

export const INSULATION_PROCESSES = {
  "Insulation AB": [
    INSULATION_PROCESS_COMPRESSOR,
    INSULATION_PROCESS_COMPONENT
  ]
};

export const INSULATION_PROCESS_BY_ITEM = {
  "COMPRESSOR": INSULATION_PROCESS_COMPRESSOR,
  "EVAPORATOR": INSULATION_PROCESS_COMPONENT,
  "CONDENSER": INSULATION_PROCESS_COMPONENT,
  "ECONOMIZER": INSULATION_PROCESS_COMPONENT,
  "OIL SEPARATOR": INSULATION_PROCESS_COMPONENT
};

export const INSULATION_ITEM_BY_MODEL = {
    "UAASV3": ["EVAPORATOR", "COMPRESSOR"],
    "UAAST3": ["EVAPORATOR", "COMPRESSOR"],
    "HXE-M": ["EVAPORATOR", "CONDENSER", "ECONOMIZER", "COMPRESSOR"],
    "HXE-TG": ["EVAPORATOR", "CONDENSER", "ECONOMIZER", "COMPRESSOR"],
    "HXE-TT": ["EVAPORATOR", "CONDENSER", "ECONOMIZER", "COMPRESSOR"],
    "MUWD": ["EVAPORATOR", "CONDENSER", "COMPRESSOR"],
    "UWD": ["EVAPORATOR", "COMPRESSOR"],
    "ZUWV": ["EVAPORATOR", "CONDENSER", "ECONOMIZER", "OIL SEPARATOR", "COMPRESSOR"],
    "ZUWY": ["EVAPORATOR", "CONDENSER", "ECONOMIZER", "OIL SEPARATOR", "COMPRESSOR"],
    "HT": ["EVAPORATOR", "CONDENSER"],
    "ZUWS": ["EVAPORATOR", "CONDENSER", "ECONOMIZER", "OIL SEPARATOR", "COMPRESSOR"]
}
