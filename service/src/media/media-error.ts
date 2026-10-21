export class MediaProcessingError extends Error {}

// Translate known yt-dlp diagnostics without returning URLs, tokens or filesystem paths.
export function mediaFailure(stderr: string): MediaProcessingError {
  if (/sign in|log.?in|confirm you.re not a bot|cookies.*required|authentication required/i.test(stderr)) return new MediaProcessingError('The media provider requires authentication or rejected this server. Try another public video; login-only downloads are not supported.');
  if (/requested format.*not available|no video formats found/i.test(stderr)) return new MediaProcessingError('The requested output format or resolution is unavailable for this media. Try MP3 or a different video.');
  if (/video unavailable|private video|has been removed|not available in your country|not available from your location/i.test(stderr)) return new MediaProcessingError('This media is unavailable, private, removed, or region-restricted.');
  if (/ffmpeg.*not found|ffprobe.*not found|ffmpeg.*not installed/i.test(stderr)) return new MediaProcessingError('FFmpeg or FFprobe is unavailable on the server. Reinstall the media tools and restart.');
  if (/timed out|unable to download|http error|connection|unable to connect/i.test(stderr)) return new MediaProcessingError('The server could not retrieve the media from its provider. Retry later or try another public video.');
  return new MediaProcessingError('The provider could not complete this download. The media may be unsupported or unavailable.');
}
