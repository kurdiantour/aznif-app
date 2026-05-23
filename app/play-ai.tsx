import { Redirect } from 'expo-router';

export default function PlayAIModeScreen() {
  return (
    <Redirect
      href={{
        pathname: '/game',
        params: {
          mode: '1v1',
          practice: 'true',
        },
      }}
    />
  );
}