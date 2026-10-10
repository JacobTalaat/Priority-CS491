import { prisma } from "@/lib/prisma";
import { decryptSecret, encryptSecret } from "@/lib/secrets";
import { CalendarFeedError } from "./calendar-feed";

const FEED_SELECT = {
  canvasCalendarFeedCipher: true,
  canvasCalendarFeedIv: true,
  canvasCalendarFeedTag: true,
} as const;

export async function saveCalendarFeed(userId: string, feedUrl: string): Promise<void> {
  const encrypted = encryptSecret(feedUrl);
  await prisma.user.update({
    where: { id: userId },
    data: {
      canvasCalendarFeedCipher: encrypted.cipher,
      canvasCalendarFeedIv: encrypted.iv,
      canvasCalendarFeedTag: encrypted.tag,
    },
  });
}

export async function getCalendarFeedStatus(userId: string): Promise<{ configured: boolean }> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: FEED_SELECT });
  return {
    configured: Boolean(
      user?.canvasCalendarFeedCipher && user.canvasCalendarFeedIv && user.canvasCalendarFeedTag,
    ),
  };
}

export async function getCalendarFeedUrl(userId: string): Promise<string | null> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: FEED_SELECT });
  const cipher = user?.canvasCalendarFeedCipher;
  const iv = user?.canvasCalendarFeedIv;
  const tag = user?.canvasCalendarFeedTag;
  if (!cipher && !iv && !tag) {
    return null;
  }
  if (!cipher || !iv || !tag) {
    throw new CalendarFeedError("The saved Canvas calendar feed is incomplete. Replace it in Settings.");
  }
  try {
    return decryptSecret({ cipher, iv, tag });
  } catch {
    throw new CalendarFeedError("The saved Canvas calendar feed could not be decrypted. Replace it in Settings.");
  }
}

export async function clearCalendarFeed(userId: string): Promise<void> {
  await prisma.user.update({
    where: { id: userId },
    data: {
      canvasCalendarFeedCipher: null,
      canvasCalendarFeedIv: null,
      canvasCalendarFeedTag: null,
    },
  });
}
