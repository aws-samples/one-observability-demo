using System.Collections.Generic;
using System.Diagnostics.Metrics;

namespace PetSite.Telemetry
{
    /// <summary>
    /// Custom business metrics for the PetSite frontend, defined with System.Diagnostics.Metrics.
    ///
    /// The ADOT .NET auto-instrumentation injected into the pod picks up this meter through
    /// OTEL_DOTNET_AUTO_METRICS_ADDITIONAL_SOURCES and exports it over OTLP to the CloudWatch agent,
    /// which forwards it to the CloudWatch OTLP metrics endpoint (queryable with PromQL).
    /// Names and units follow OpenTelemetry conventions. Attribute values are normalized to small,
    /// fixed sets because they come from user-supplied query parameters.
    /// </summary>
    public static class PetSiteMetrics
    {
        public const string MeterName = "PetSite";

        private static readonly Meter Meter = new(MeterName, "1.0");

        private static readonly HashSet<string> KnownPetTypes = new() { "puppy", "kitten", "bunny" };
        private static readonly HashSet<string> KnownPetColors = new() { "black", "brown", "grey", "white" };

        private static readonly Counter<long> Searches = Meter.CreateCounter<long>(
            "petsite.searches", unit: "{search}", description: "Pet searches performed from the PetSite");

        private static readonly Counter<long> Adoptions = Meter.CreateCounter<long>(
            "petsite.adoptions", unit: "{adoption}", description: "Pet adoptions submitted from the PetSite");

        private static readonly Histogram<double> PaymentDuration = Meter.CreateHistogram<double>(
            "petsite.payment.duration", unit: "s", description: "Duration of calls to the payment API");

        private static int _petsAvailable;

        static PetSiteMetrics()
        {
            Meter.CreateObservableGauge(
                "petsite.pets.available",
                () => System.Threading.Volatile.Read(ref _petsAvailable),
                unit: "{pet}",
                description: "Pets available for adoption in the most recent unfiltered listing");
        }

        public static void RecordSearch(string petType, string petColor) =>
            Searches.Add(1,
                new KeyValuePair<string, object>("pet.type", NormalizeType(petType)),
                new KeyValuePair<string, object>("pet.color", NormalizeColor(petColor)));

        public static void RecordAdoption(string petType, bool succeeded, double paymentSeconds)
        {
            var type = new KeyValuePair<string, object>("pet.type", NormalizeType(petType));
            var outcome = new KeyValuePair<string, object>("outcome", succeeded ? "success" : "failure");
            Adoptions.Add(1, type, outcome);
            PaymentDuration.Record(paymentSeconds, type, outcome);
        }

        public static void SetPetsAvailable(int count) =>
            System.Threading.Volatile.Write(ref _petsAvailable, count);

        private static string NormalizeType(string value) =>
            string.IsNullOrEmpty(value) || value == "all" ? "all" :
            KnownPetTypes.Contains(value) ? value : "other";

        private static string NormalizeColor(string value) =>
            string.IsNullOrEmpty(value) || value == "all" ? "all" :
            KnownPetColors.Contains(value) ? value : "other";
    }
}
