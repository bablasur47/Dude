import { setAuthTokenGetter } from "@workspace/api-client-react";

export function setupAuth() {
  setAuthTokenGetter(() => {
    return localStorage.getItem("dashboard_token");
  });
}
