import { NextResponse } from "next/server";
import { getCohortReport } from "@/lib/data-loader";

export async function GET() {
  const report = getCohortReport();
  return NextResponse.json(report);
}
