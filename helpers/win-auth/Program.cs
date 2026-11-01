// win-auth: Windows Hello and Microsoft single sign-on for the Raycast extensions.
//
//   win-auth hello status                         {"available":true}
//   win-auth hello create --name <key>            create (or replace) a Windows Hello key; Windows asks for PIN/fingerprint/face
//   win-auth hello sign --name <key> --data <b64> {"signature":"<b64>"} – Windows asks for Hello
//   win-auth hello delete --name <key>
//   win-auth token --tenant <id> --client <id> --scopes "<a> <b>" --cache <dir>
//                                                 {"accessToken":"…","account":"…","expiresOn":"…"} via the Windows account broker
//   win-auth signout --tenant <id> --client <id> --cache <dir>
//
// Every answer is one JSON line on stdout; errors are {"error":"…","code":"…"} with exit code 1.
// Windows Hello RSA signatures (PKCS#1 v1.5) are deterministic, so the caller can derive a key from
// the signature of a fixed challenge: without Hello on this device that key cannot be produced.
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading.Tasks;
using Microsoft.Identity.Client;
using Microsoft.Identity.Client.Broker;
using Microsoft.Identity.Client.Extensions.Msal;
using Windows.Security.Credentials;
using Windows.Security.Cryptography;

namespace WinAuth;

internal static class Program
{
    private static int Main(string[] args)
    {
        Console.OutputEncoding = new UTF8Encoding(false);
        try
        {
            var options = Options(args);
            var result = (args.ElementAtOrDefault(0), args.ElementAtOrDefault(1)) switch
            {
                ("hello", "status") => Hello.Status().GetAwaiter().GetResult(),
                ("hello", "create") => Hello.Create(Require(options, "name")).GetAwaiter().GetResult(),
                ("hello", "sign") => Hello.Sign(Require(options, "name"), Require(options, "data")).GetAwaiter().GetResult(),
                ("hello", "delete") => Hello.Delete(Require(options, "name")).GetAwaiter().GetResult(),
                ("token", _) => Sso.Token(options).GetAwaiter().GetResult(),
                ("signout", _) => Sso.SignOut(options).GetAwaiter().GetResult(),
                _ => throw new Failure("usage", "usage: win-auth hello status|create|sign|delete … | token … | signout …"),
            };
            Console.WriteLine(result);
            return 0;
        }
        catch (Failure f)
        {
            Console.WriteLine(Json.Object(("error", f.Message), ("code", f.Code)));
        }
        catch (MsalException ex)
        {
            var cancelled = ex.ErrorCode is "authentication_canceled" or "user_canceled";
            Console.WriteLine(Json.Object(("error", cancelled ? "Sign-in cancelled" : ex.Message), ("code", cancelled ? "cancelled" : ex.ErrorCode)));
        }
        catch (Exception ex)
        {
            Console.WriteLine(Json.Object(("error", ex.Message), ("code", ex.GetType().Name)));
        }

        return 1;
    }

    private static Dictionary<string, string> Options(string[] args)
    {
        var options = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        for (var i = 0; i < args.Length - 1; i++)
        {
            if (args[i].StartsWith("--", StringComparison.Ordinal))
            {
                options[args[i].Substring(2)] = args[i + 1];
            }
        }

        return options;
    }

    internal static string Require(Dictionary<string, string> options, string name) =>
        options.TryGetValue(name, out var value) && value.Length > 0 ? value : throw new Failure("usage", $"--{name} is missing");
}

internal sealed class Failure(string code, string message) : Exception(message)
{
    public string Code { get; } = code;
}

internal static class Hello
{
    public static async Task<string> Status() => Json.Object(("available", await KeyCredentialManager.IsSupportedAsync()));

    public static async Task<string> Create(string name)
    {
        if (!await KeyCredentialManager.IsSupportedAsync())
        {
            throw new Failure("unavailable", "Windows Hello is not set up on this PC (Settings → Accounts → Sign-in options)");
        }

        Foreground.Prepare();
        var created = await KeyCredentialManager.RequestCreateAsync(name, KeyCredentialCreationOption.ReplaceExisting);
        Check(created.Status);
        return Json.Object(("ok", true));
    }

    public static async Task<string> Sign(string name, string data)
    {
        var opened = await KeyCredentialManager.OpenAsync(name);
        Check(opened.Status);
        Foreground.Prepare();
        var signed = await opened.Credential.RequestSignAsync(CryptographicBuffer.DecodeFromBase64String(data));
        Check(signed.Status);
        return Json.Object(("signature", CryptographicBuffer.EncodeToBase64String(signed.Result)));
    }

    public static async Task<string> Delete(string name)
    {
        await KeyCredentialManager.DeleteAsync(name);
        return Json.Object(("ok", true));
    }

    private static void Check(KeyCredentialStatus status)
    {
        switch (status)
        {
            case KeyCredentialStatus.Success:
                return;
            case KeyCredentialStatus.UserCanceled:
                throw new Failure("cancelled", "Windows Hello was cancelled");
            case KeyCredentialStatus.NotFound:
                throw new Failure("notfound", "No Windows Hello key for this extension on this PC – enable Windows Hello again");
            case KeyCredentialStatus.UserPrefersPassword:
                throw new Failure("password", "Use the password");
            case KeyCredentialStatus.SecurityDeviceLocked:
                throw new Failure("locked", "Windows Hello is locked – try again later or use the password");
            default:
                throw new Failure("failed", $"Windows Hello: {status}");
        }
    }
}

internal static class Sso
{
    public static async Task<string> Token(Dictionary<string, string> options)
    {
        var app = await App(options);
        var scopes = Program.Require(options, "scopes").Split(new[] { ' ', ',' }, StringSplitOptions.RemoveEmptyEntries)
            .Where(s => s is not ("offline_access" or "openid" or "profile"))
            .ToArray();
        var account = (await app.GetAccountsAsync()).FirstOrDefault() ?? PublicClientApplication.OperatingSystemAccount;
        AuthenticationResult result;
        try
        {
            result = await app.AcquireTokenSilent(scopes, account).ExecuteAsync();
        }
        catch (MsalUiRequiredException)
        {
            // first sign-in, consent or MFA: the Windows sign-in dialog
            Foreground.Prepare();
            result = await app.AcquireTokenInteractive(scopes).WithAccount(account).ExecuteAsync();
        }

        return Json.Object(("accessToken", result.AccessToken), ("account", result.Account?.Username ?? string.Empty), ("expiresOn", result.ExpiresOn.UtcDateTime.ToString("o")));
    }

    public static async Task<string> SignOut(Dictionary<string, string> options)
    {
        var app = await App(options);
        foreach (var account in await app.GetAccountsAsync())
        {
            await app.RemoveAsync(account);
        }

        return Json.Object(("ok", true));
    }

    private static async Task<IPublicClientApplication> App(Dictionary<string, string> options)
    {
        var client = Program.Require(options, "client");
        var tenant = options.TryGetValue("tenant", out var t) && t.Length > 0 ? t : "organizations";
        var app = PublicClientApplicationBuilder.Create(client)
            .WithAuthority(AzureCloudInstance.AzurePublic, tenant)
            .WithRedirectUri($"ms-appx-web://microsoft.aad.brokerplugin/{client}")
            .WithBroker(new BrokerOptions(BrokerOptions.OperatingSystems.Windows) { Title = "Raycast" })
            .WithParentActivityOrWindow(Foreground.Window)
            .Build();
        var cache = Program.Require(options, "cache");
        Directory.CreateDirectory(cache);
        var storage = new StorageCreationPropertiesBuilder("msal.cache", cache).Build();
        (await MsalCacheHelper.CreateAsync(storage)).RegisterCache(app.UserTokenCache);
        return app;
    }
}

/// <summary>Windows dialogs (Hello, sign-in) attach to the window in front – Raycast, which started us.</summary>
internal static class Foreground
{
    private static IntPtr _window;

    public static IntPtr Window() => _window != IntPtr.Zero ? _window : GetForegroundWindow();

    public static void Prepare() => _window = GetForegroundWindow();

    [DllImport("user32.dll")]
    private static extern IntPtr GetForegroundWindow();
}

internal static class Json
{
    public static string Object(params (string Key, object Value)[] pairs) =>
        "{" + string.Join(",", pairs.Select(p => $"{Quote(p.Key)}:{Value(p.Value)}")) + "}";

    private static string Value(object value) => value switch
    {
        bool b => b ? "true" : "false",
        _ => Quote(value?.ToString() ?? string.Empty),
    };

    private static string Quote(string s)
    {
        var sb = new StringBuilder("\"");
        foreach (var c in s)
        {
            sb.Append(c switch
            {
                '"' => "\\\"",
                '\\' => "\\\\",
                '\n' => "\\n",
                '\r' => "\\r",
                '\t' => "\\t",
                _ when c < 0x20 => $"\\u{(int)c:x4}",
                _ => c.ToString(),
            });
        }

        return sb.Append('"').ToString();
    }
}
