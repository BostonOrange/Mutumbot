import NextAuth, { type NextAuthResult } from 'next-auth';
import Discord from 'next-auth/providers/discord';

const adminUserIds = (process.env.ADMIN_USER_IDS || '')
  .split(',')
  .map((id) => id.trim())
  .filter(Boolean);

const result: NextAuthResult = NextAuth({
  providers: [
    Discord({
      clientId: process.env.DISCORD_CLIENT_ID!,
      clientSecret: process.env.DISCORD_CLIENT_SECRET!,
    }),
  ],
  callbacks: {
    async signIn({ profile }) {
      if (!profile?.id) return false;
      return adminUserIds.includes(profile.id as string);
    },
    async jwt({ token, profile }) {
      if (profile?.id) {
        token.discordId = profile.id as string;
      }
      return token;
    },
    async session({ session, token }) {
      if (token.discordId) {
        (session as any).discordId = token.discordId;
      }
      return session;
    },
  },
  pages: {
    signIn: '/api/auth/signin',
    error: '/api/auth/error',
  },
  secret: process.env.NEXTAUTH_SECRET,
});

export const handlers: NextAuthResult['handlers'] = result.handlers;
export const auth: NextAuthResult['auth'] = result.auth;
export const signIn: NextAuthResult['signIn'] = result.signIn;
export const signOut: NextAuthResult['signOut'] = result.signOut;
