import { prisma } from "@/lib/prisma";
import { decryptSecret, encryptSecret } from "@/lib/secrets";

export async function saveCanvasToken(userId: string, baseUrl: string, token: string): Promise<void> {
  const parts = encryptSecret(token);
  await prisma.user.update({
    where: { id: userId },
    data: {
      canvasTokenCipher: parts.cipher,
      canvasTokenIv: parts.iv,
      canvasTokenTag: parts.tag,
      canvasBaseUrl: baseUrl,
      canvasCheckedAt: new Date(),
    },
  });
}

export async function getCanvasToken(userId: string): Promise<{ baseUrl: string; token: string } | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { canvasTokenCipher: true, canvasTokenIv: true, canvasTokenTag: true, canvasBaseUrl: true },
  });
  if (!user?.canvasTokenCipher || !user.canvasTokenIv || !user.canvasTokenTag || !user.canvasBaseUrl) {
    return null;
  }
  try {
    const token = decryptSecret({
      cipher: user.canvasTokenCipher,
      iv: user.canvasTokenIv,
      tag: user.canvasTokenTag,
    });
    return { baseUrl: user.canvasBaseUrl, token };
  } catch {
    return null;
  }
}

export async function clearCanvasToken(userId: string): Promise<void> {
  await prisma.user.update({
    where: { id: userId },
    data: {
      canvasTokenCipher: null,
      canvasTokenIv: null,
      canvasTokenTag: null,
      canvasBaseUrl: null,
      canvasCheckedAt: null,
    },
  });
}

export async function getCanvasStatus(userId: string): Promise<{
  connected: boolean;
  baseUrl: string | null;
  checkedAt: Date | null;
}> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      canvasTokenCipher: true,
      canvasTokenIv: true,
      canvasTokenTag: true,
      canvasBaseUrl: true,
      canvasCheckedAt: true,
    },
  });
  return {
    connected: Boolean(
      user?.canvasTokenCipher && user?.canvasTokenIv && user?.canvasTokenTag && user?.canvasBaseUrl
    ),
    baseUrl: user?.canvasBaseUrl ?? null,
    checkedAt: user?.canvasCheckedAt ?? null,
  };
}
