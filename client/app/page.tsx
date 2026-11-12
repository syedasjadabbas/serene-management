import { HomeRedirect } from "./_components/HomeRedirect";

/** Entry point; the redirect to the default property is decided on the client (see HomeRedirect). */
export default function Home() {
  return <HomeRedirect />;
}
