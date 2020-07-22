using Amazon.Lambda.PowerShellHost;

namespace seed
{
    public class Bootstrap : PowerShellFunctionHost
    {
        public Bootstrap() : base("seed.ps1")
        {
        }
    }
}
