import { createApp } from "./app.js";

const port = Number.parseInt(process.env.FACETEST_API_PORT || "3001", 10);
const app = await createApp();

app.listen(port, () => {
  console.log(`unsw-face api listening on ${port}`);
});
