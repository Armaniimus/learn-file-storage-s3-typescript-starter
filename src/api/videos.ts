import { respondWithJSON } from "./json";
import { getBearerToken, validateJWT } from "../auth";
import { BadRequestError, NotFoundError, UserForbiddenError } from "./errors";
import { deleteVideo, getVideo, updateVideo } from "../db/videos";
import { randomBytes } from "crypto";

import { type ApiConfig } from "../config";
import { s3, S3Client, type BunRequest } from "bun";
import { unlink } from "fs/promises";
import { type Video } from "../db/videos";

export async function handlerUploadVideo(cfg: ApiConfig, req: BunRequest) {
  const { videoId } = req.params as { videoId?: string };
  if (!videoId) {
    throw new BadRequestError("Invalid video ID");
  }

  const token = getBearerToken(req.headers);
  const userID = validateJWT(token, cfg.jwtSecret);

  const videoMeta = await getVideo(cfg.db, videoId);
  if (videoMeta == undefined) {
    throw new BadRequestError("video does not exist");

  } else if (videoMeta.userID !== userID) {
    throw new UserForbiddenError("you cant upload thumbnail to another persons thumbnail");
  }

  console.log("uploading video", videoId, "by user", userID);

  const formdata = await req.formData();
  const videoFormData = formdata.get("video");
  if (!(videoFormData instanceof File)) {
    throw new BadRequestError("video is not an instance of file");
  } 

  const MAX_UPLOAD_SIZE = 1 << 30;
  if (videoFormData.size > MAX_UPLOAD_SIZE) {
    throw new BadRequestError("video is greater then 1gb");
  }
    
  const isVideo = (videoFormData.type == "video/mp4");
  if (!isVideo) {
    throw new BadRequestError("video isn't an video mime type");
  }
  
  const arrayBuffer = await videoFormData.arrayBuffer()
  const filename = randomBytes(32).toString("base64url") + "." +videoFormData.type.split("/")[1];
  const fileUrl = `${cfg.assetsRoot}/${filename}`;  
  await Bun.write(fileUrl, arrayBuffer);  
  const processedFile = await processVideoForFastStart(fileUrl);

  try {
    const prefix = await getVideoAspectRatio(processedFile);
    const key = `${prefix}/${filename}`;
    videoMeta.videoURL = `${cfg.s3CfDistribution}/${key}`

    const s3File = await cfg.s3Client.file(key)
    await s3File.write(Bun.file(processedFile), { type: videoFormData.type });
    await updateVideo(cfg.db, videoMeta);
  } finally {
    unlink(fileUrl);
    unlink(processedFile);
  } 
  
  return respondWithJSON(200, null);
}

async function getVideoAspectRatio(filePath: string) {
  const file = await Bun.spawn({
    cmd: ["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "json", filePath],
    stderr: "pipe",
    stdout: "pipe"
  });

  if (await file.exited != 0) {
    const stderrText = await new Response(file.stderr).text();
    console.error(stderrText);
  } else {
    const stdoutJson = await new Response(file.stdout).json();
    const width = stdoutJson.streams[0].width;
    const height = stdoutJson.streams[0].height;

    const isLandscape = () => Math.floor(width / 16) == Math.floor(height / 9);
    const isPortrait = () => Math.floor(width / 9) == Math.floor(height / 16);

    if (isLandscape()) {
      return "landscape"
    } else if (isPortrait()) {
      return "portrait"
    }
    return "other"
  }
}

async function processVideoForFastStart(inputFilePath:string) {
  const outputPath = inputFilePath + ".processed"
  const command = await Bun.spawn({
    cmd: ["ffmpeg", "-i", inputFilePath, "-movflags", "faststart", "-map_metadata", "0", "-codec", "copy", "-f", "mp4", outputPath],
  });
  const result = await command.exited
  console.log(result);
  
  return outputPath;
}