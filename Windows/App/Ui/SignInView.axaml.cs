using Avalonia.Controls;

namespace Echo.Ui;

/// Sign in with username and password; when the server asks for it, the two-factor code, in the same
/// request again (POST /auth/device answers 401 totp_required). The token goes to `signedIn`.
public partial class SignInView : UserControl
{
    readonly Api api;
    readonly Action<string> signedIn;

    public SignInView() : this(new Api("https://echo.invalid"), _ => { }) { } // the XAML previewer

    public SignInView(Api api, Action<string> signedIn)
    {
        this.api = api;
        this.signedIn = signedIn;
        InitializeComponent();
        SubmitButton.Click += (_, _) => _ = Submit();
    }

    public string Username { get => UserBox.Text ?? ""; set => UserBox.Text = value; }
    public string Password { get => PasswordBox.Text ?? ""; set => PasswordBox.Text = value; }
    public bool CodeVisible => CodePanel.IsVisible;

    public async Task Submit()
    {
        Error.IsVisible = false;
        SubmitButton.IsEnabled = false;
        try
        {
            var name = $"ECHO for Windows ({Environment.MachineName})";
            signedIn(await api.SignIn(Username.Trim(), Password, CodeVisible ? CodeBox.Text ?? "" : "", name));
        }
        catch (ApiException e) when (e.Code == "totp_required")
        {
            Heading.Text = "Two-factor code";
            CodePanel.IsVisible = true;
            SubmitButton.Content = "Verify";
            CodeBox.Focus();
        }
        catch (ApiException e) when (e.Code == "rate_limited")
        {
            Show("Too many attempts. Try again in a minute.");
        }
        catch (ApiException e) when (e.SignedOut)
        {
            Show(CodeVisible ? "That code didn't work. Try the next one." : "Username or password is incorrect.");
        }
        catch (Exception e) when (e is HttpRequestException or ApiException or TaskCanceledException)
        {
            Show("Can't reach the server.");
        }
        finally
        {
            SubmitButton.IsEnabled = true;
        }
    }

    void Show(string message)
    {
        Error.Text = message;
        Error.IsVisible = true;
    }
}
