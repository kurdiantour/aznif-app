import { Redirect } from "expo-router";

// Preserve existing notification and deep links without showing the retired table lobby.
export default function OkeyAznifRoute() {
  return <Redirect href={{ pathname: "/okey", params: { currency: "aznif" } } as never} />;
}
