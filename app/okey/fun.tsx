import { Redirect } from "expo-router";

// Preserve existing notification and deep links without showing the retired table lobby.
export default function OkeyFunRoute() {
  return <Redirect href={{ pathname: "/okey", params: { currency: "fun" } } as never} />;
}
