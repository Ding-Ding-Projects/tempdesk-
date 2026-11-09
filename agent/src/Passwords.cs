using System;
using System.Security.Cryptography;
using System.Text;

namespace TempDesk.Agent
{
    /// <summary>
    /// Cryptographically secure generation of guest usernames and passwords,
    /// and a constant-time comparison for API keys. All randomness comes from
    /// RNGCryptoServiceProvider.
    /// </summary>
    public static class Passwords
    {
        // Unambiguous lowercase + digits for usernames (no l, i, o, 0, 1).
        private const string UsernameAlphabet = "abcdefghjkmnpqrstuvwxyz23456789";

        // Unambiguous character classes for passwords.
        private const string Lower = "abcdefghjkmnpqrstuvwxyz";
        private const string Upper = "ABCDEFGHJKLMNPQRSTUVWXYZ";
        private const string Digits = "23456789";
        private const string Symbols = "!@#%+=?";

        private static readonly RNGCryptoServiceProvider Rng = new RNGCryptoServiceProvider();

        /// <summary>Six random characters appended to the prefix, e.g. "guest-ab2k9p".</summary>
        public static string NewUsername(string prefix)
        {
            return prefix + RandomString(UsernameAlphabet, 6);
        }

        /// <summary>
        /// A random password of the requested length, guaranteed to contain at
        /// least one lowercase, uppercase, digit and symbol, drawn only from the
        /// unambiguous sets. Minimum length is 8 so the four guarantees fit.
        /// </summary>
        public static string NewPassword(int length)
        {
            if (length < 8)
            {
                length = 8;
            }
            string all = Lower + Upper + Digits + Symbols;
            char[] chars = new char[length];

            // Guarantee one from each class, then fill the remainder.
            chars[0] = PickOne(Lower);
            chars[1] = PickOne(Upper);
            chars[2] = PickOne(Digits);
            chars[3] = PickOne(Symbols);
            for (int i = 4; i < length; i++)
            {
                chars[i] = PickOne(all);
            }

            // Fisher-Yates shuffle with unbiased random indices so the
            // guaranteed characters are not always at the front.
            for (int i = length - 1; i > 0; i--)
            {
                int j = NextInt(i + 1);
                char tmp = chars[i];
                chars[i] = chars[j];
                chars[j] = tmp;
            }
            return new string(chars);
        }

        private static string RandomString(string alphabet, int count)
        {
            StringBuilder sb = new StringBuilder(count);
            for (int i = 0; i < count; i++)
            {
                sb.Append(PickOne(alphabet));
            }
            return sb.ToString();
        }

        private static char PickOne(string alphabet)
        {
            return alphabet[NextInt(alphabet.Length)];
        }

        /// <summary>
        /// A uniformly distributed integer in [0, bound) using rejection
        /// sampling so there is no modulo bias.
        /// </summary>
        private static int NextInt(int bound)
        {
            if (bound <= 0)
            {
                throw new ArgumentOutOfRangeException("bound");
            }
            byte[] buffer = new byte[4];
            // Largest multiple of bound that fits in the 32-bit range; reject above it. The limit is kept
            // as 64 bits: when bound divides 2^32 exactly (1, 2, 4, 8, 16...) it equals 2^32, which wraps
            // to 0 as a uint and made this loop spin forever (the digit alphabet has 8 characters).
            long limit = 0x100000000L - (0x100000000L % bound);
            while (true)
            {
                Rng.GetBytes(buffer);
                uint value = BitConverter.ToUInt32(buffer, 0);
                if ((long)value < limit)
                {
                    return (int)(value % (uint)bound);
                }
            }
        }

        /// <summary>
        /// Compares two secrets in constant time with respect to their content,
        /// so a timing attacker cannot learn how many leading bytes matched.
        /// </summary>
        public static bool ConstantTimeEquals(string a, string b)
        {
            if (a == null || b == null)
            {
                return false;
            }
            byte[] ba = Encoding.UTF8.GetBytes(a);
            byte[] bb = Encoding.UTF8.GetBytes(b);
            return ConstantTimeEquals(ba, bb);
        }

        public static bool ConstantTimeEquals(byte[] a, byte[] b)
        {
            if (a == null || b == null)
            {
                return false;
            }
            // Fold the length difference into the result rather than returning
            // early, and still walk the longer of the two buffers.
            int diff = a.Length ^ b.Length;
            int max = a.Length > b.Length ? a.Length : b.Length;
            for (int i = 0; i < max; i++)
            {
                byte x = i < a.Length ? a[i] : (byte)0;
                byte y = i < b.Length ? b[i] : (byte)0;
                diff |= x ^ y;
            }
            return diff == 0;
        }

        public static byte[] RandomBytes(int count)
        {
            byte[] buffer = new byte[count];
            Rng.GetBytes(buffer);
            return buffer;
        }
    }
}
