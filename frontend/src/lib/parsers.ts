export interface ParserOption {
  id: string;
  name: string;
  fileType: string;
  description: string;
}

export type ParserMode = "bank" | "trip";

export async function getParserOptions(
  mode: ParserMode = "bank",
): Promise<ParserOption[]> {
  try {
    const parserServiceUrl =
      process.env.PARSER_SERVICE_URL || "http://localhost:4000";
    const response = await fetch(`${parserServiceUrl}/parsers?mode=${mode}`, {
      cache: "no-store", // Always fetch fresh parser list
    });

    if (!response.ok) {
      console.error(
        "Failed to fetch parsers from service:",
        response.statusText,
      );
      // Return fallback parsers if service is down
      return getFallbackParsers(mode);
    }

    const data = await response.json();
    return data.parsers || [];
  } catch (error) {
    console.error("Error fetching parser options:", error);
    // Return fallback parsers if service is unreachable
    return getFallbackParsers(mode);
  }
}

function getFallbackParsers(mode: ParserMode): ParserOption[] {
  const bankParsers: ParserOption[] = [
    {
      id: "generic_csv",
      name: "Generic CSV",
      fileType: "csv",
      description: "Standard CSV file format",
    },
    {
      id: "dbs_paylah_statement",
      name: "DBS PayLah! Statement",
      fileType: "pdf",
      description: "Parser for DBS PayLah! wallet statements",
    },
    {
      id: "dbs_posb_consolidated",
      name: "DBS/POSB Consolidated Statement",
      fileType: "pdf",
      description: "Parser for DBS/POSB monthly statements",
    },
    {
      id: "dbs_posb_consolidated_legacy",
      name: "DBS/POSB Consolidated Statement (Jan 2021 and earlier)",
      fileType: "pdf",
      description: "Parser for the legacy DBS/POSB consolidated statement layout",
    },
    {
      id: "ocbc_frank_statement",
      name: "OCBC FRANK Account Statement",
      fileType: "pdf",
      description: "Parser for OCBC FRANK account statements",
    },
  ];

  const tripParsers: ParserOption[] = [
    {
      id: "revolut_statement",
      name: "Revolut Statement",
      fileType: "pdf/csv",
      description: "Trip parser for Revolut statements (PDF, CSV, or merged PDF+CSV)",
    },
    {
      id: "youtrip_statement",
      name: "YouTrip Statement",
      fileType: "pdf",
      description: "Trip parser for YouTrip statements",
    },
  ];

  return mode === "trip" ? tripParsers : bankParsers;
}
