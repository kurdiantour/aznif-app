import { Redirect } from 'expo-router';

export default function DominoTwoVsTwoPreviewRoute() {
  if (!__DEV__) return <Redirect href="/(tabs)/play" />;
  return <Redirect href={{ pathname: '/domino/game', params: { mode: '2v2', preview: 'true' } }} />;
}
