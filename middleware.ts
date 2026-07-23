import { NextRequest, NextResponse } from "next/server";

// 设 PACKUP_BASIC_AUTH="用户名:密码" 即启用全站 Basic Auth;不设则完全放行(本地开发)。
const AUTH = process.env.PACKUP_BASIC_AUTH;

export function middleware(req: NextRequest) {
  if (!AUTH) return NextResponse.next();
  const header = req.headers.get("authorization");
  if (header?.startsWith("Basic ") && atob(header.slice(6)) === AUTH) {
    return NextResponse.next();
  }
  return new NextResponse("Auth required", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="packup"' },
  });
}
