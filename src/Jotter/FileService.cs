using System.IO;
using System.Text;

namespace Jotter;

public sealed record FileData(string Path, string Name, string Content, string Encoding, string Eol, long Mtime);

/// <summary>An error whose message is meant for the user (already in Chinese).</summary>
public sealed class UserException(string message) : Exception(message);

/// <summary>
/// Reads and writes text files, keeping their encoding and line endings.
/// Content handed to the editor always uses "\n"; the original ending is restored on save.
/// </summary>
public static class FileService
{
    public const long MaxSize = 64L * 1024 * 1024;

    static readonly UTF8Encoding Utf8Strict = new(encoderShouldEmitUTF8Identifier: false, throwOnInvalidBytes: true);
    static readonly UTF8Encoding Utf8NoBom = new(encoderShouldEmitUTF8Identifier: false);

    static FileService()
    {
        System.Text.Encoding.RegisterProvider(CodePagesEncodingProvider.Instance);
    }

    static System.Text.Encoding Gbk => System.Text.Encoding.GetEncoding("GB18030");

    public static FileData Read(string path)
    {
        var info = new FileInfo(path);
        if (!info.Exists) throw new UserException("文件不存在");
        if (info.Length > MaxSize)
            throw new UserException($"文件太大（{info.Length / 1024 / 1024} MB），最多打开 {MaxSize / 1024 / 1024} MB");
        var (text, encoding) = Decode(File.ReadAllBytes(info.FullName));
        var eol = DetectEol(text);
        text = text.Replace("\r\n", "\n").Replace('\r', '\n');
        return new FileData(info.FullName, info.Name, text, encoding, eol, Mtime(info.FullName));
    }

    public static (string Text, string Encoding) Decode(byte[] b)
    {
        if (b.Length >= 3 && b[0] == 0xEF && b[1] == 0xBB && b[2] == 0xBF)
            return (Utf8NoBom.GetString(b, 3, b.Length - 3), "UTF-8 BOM");
        if (b.Length >= 2 && b[0] == 0xFF && b[1] == 0xFE)
            return (System.Text.Encoding.Unicode.GetString(b, 2, b.Length - 2), "UTF-16 LE");
        if (b.Length >= 2 && b[0] == 0xFE && b[1] == 0xFF)
            return (System.Text.Encoding.BigEndianUnicode.GetString(b, 2, b.Length - 2), "UTF-16 BE");
        if (LooksBinary(b)) throw new UserException("看起来是二进制文件，不能当文本打开");
        try
        {
            return (Utf8Strict.GetString(b), "UTF-8");
        }
        catch (DecoderFallbackException)
        {
            return (Gbk.GetString(b), "GBK");
        }
    }

    static bool LooksBinary(byte[] b)
    {
        int n = Math.Min(b.Length, 8192);
        for (int i = 0; i < n; i++)
            if (b[i] == 0) return true;
        return false;
    }

    /// <summary>"LF" if bare \n endings dominate, otherwise "CRLF" (also the default for new files).</summary>
    public static string DetectEol(string text)
    {
        int crlf = 0, lf = 0;
        for (int i = 0; i < text.Length; i++)
        {
            if (text[i] != '\n') continue;
            if (i > 0 && text[i - 1] == '\r') crlf++;
            else lf++;
        }
        return lf > crlf ? "LF" : "CRLF";
    }

    public static byte[] Encode(string content, string encoding, string eol)
    {
        var text = content.Replace("\r\n", "\n");
        if (eol == "CRLF") text = text.Replace("\n", "\r\n");
        return encoding switch
        {
            "UTF-8 BOM" => [.. System.Text.Encoding.UTF8.GetPreamble(), .. Utf8NoBom.GetBytes(text)],
            "UTF-16 LE" => [.. System.Text.Encoding.Unicode.GetPreamble(), .. System.Text.Encoding.Unicode.GetBytes(text)],
            "UTF-16 BE" => [.. System.Text.Encoding.BigEndianUnicode.GetPreamble(), .. System.Text.Encoding.BigEndianUnicode.GetBytes(text)],
            "GBK" => Gbk.GetBytes(text),
            _ => Utf8NoBom.GetBytes(text),
        };
    }

    /// <summary>Write through a temp file so a crash mid-write cannot leave a truncated file.</summary>
    public static long Write(string path, string content, string encoding, string eol)
    {
        var bytes = Encode(content, encoding, eol);
        var full = System.IO.Path.GetFullPath(path);
        var dir = System.IO.Path.GetDirectoryName(full)!;
        Directory.CreateDirectory(dir);
        var tmp = System.IO.Path.Combine(dir, $".{System.IO.Path.GetFileName(full)}.{Environment.ProcessId}.jotter-tmp");
        try
        {
            File.WriteAllBytes(tmp, bytes);
            if (File.Exists(full)) File.Replace(tmp, full, destinationBackupFileName: null, ignoreMetadataErrors: true);
            else File.Move(tmp, full);
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or PlatformNotSupportedException)
        {
            // Some locations (network shares, odd permissions) refuse replace; write in place instead.
            TryDelete(tmp);
            File.WriteAllBytes(full, bytes);
        }
        return Mtime(full);
    }

    public static long? MtimeOrNull(string path) => File.Exists(path) ? Mtime(path) : null;

    static long Mtime(string path) =>
        new DateTimeOffset(File.GetLastWriteTimeUtc(path), TimeSpan.Zero).ToUnixTimeMilliseconds();

    static void TryDelete(string path)
    {
        try { File.Delete(path); } catch { /* best effort */ }
    }
}
