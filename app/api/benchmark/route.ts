import { NextResponse } from "next/server";
import { getBenchmark } from "@/lib/data-loader";

export async function GET() {
  const result = getBenchmark();
  return NextResponse.json(result);
}
