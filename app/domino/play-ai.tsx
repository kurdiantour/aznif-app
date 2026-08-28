import { Redirect } from "expo-router";
import { useRef } from "react";

function createPracticeMatchId() {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (char) => {
    const random = Math.floor(Math.random() * 16);
    const value = char === "x" ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}

export default function PlayAIModeScreen() {
  const practiceMatchIdRef = useRef(createPracticeMatchId());

  return (
    <Redirect
      href={{
        pathname: "/domino/game",
        params: {
          room_id: practiceMatchIdRef.current,
          mode: "1v1",
          practice: "true",
          playMode: "fun",
        },
      }}
    />
  );
}
