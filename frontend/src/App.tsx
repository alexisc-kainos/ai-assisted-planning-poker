import { RoomPage } from './RoomPage';
import { generateRoomId, isValidRoomId, markCreator } from './room';

function Landing() {
  const createRoom = () => {
    const roomId = generateRoomId();
    markCreator(roomId);
    window.location.assign(`?room=${roomId}`);
  };

  return (
    <section className="card landing">
      <p>Open a room, share the link, and estimate together — no accounts needed.</p>
      <button type="button" className="primary" onClick={createRoom}>
        Create a room
      </button>
    </section>
  );
}

export function App() {
  const roomParam = new URLSearchParams(window.location.search).get('room');

  let content;
  if (roomParam === null) {
    content = <Landing />;
  } else if (!isValidRoomId(roomParam)) {
    content = (
      <section className="card">
        <p className="notice error" role="alert">
          This room link isn't valid. Check the link or create a new room.
        </p>
        <a href="?">Create a new room</a>
      </section>
    );
  } else {
    content = <RoomPage roomId={roomParam} />;
  }

  return (
    <main className="app">
      <h1>Planning Poker</h1>
      {content}
    </main>
  );
}
