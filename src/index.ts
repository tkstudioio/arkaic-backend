import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { CreateBucketCommand, HeadBucketCommand } from "@aws-sdk/client-s3";

import { setupWebSocket } from "@/routes/ws";
import { api } from "@/routes/api";
import { s3, MINIO_BUCKET, makePublic } from "@/lib/minio";

const app = new Hono();

app.use("*", cors());

app.route("/api", api);
const { injectWebSocket } = setupWebSocket(app);

const port = Number(process.env.PORT) || 3000;

async function ensureBucket() {
  try {
    await s3.send(new HeadBucketCommand({ Bucket: MINIO_BUCKET }));
  } catch (err: unknown) {
    if (err && typeof err === "object" && "name" in err && err.name === "NotFound") {
      await s3.send(new CreateBucketCommand({ Bucket: MINIO_BUCKET }));
      console.log(`Created MinIO bucket: ${MINIO_BUCKET}`);
    } else {
      throw err;
    }
  }
  await makePublic();
  console.log(`Made bucket ${MINIO_BUCKET} publicly readable`);
}

await ensureBucket();

const server = serve({ fetch: app.fetch, port }, () => {
  console.log(`Server running on port ${port}`);
});

injectWebSocket(server);

export default app;
