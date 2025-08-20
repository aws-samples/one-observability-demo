using System;
using System.Collections.Generic;

namespace PetSite.ViewModels
{
    public class NutritionalInfo
    {
        public int? calories_per_serving { get; set; }
        public string protein_percentage { get; set; }
        public string fat_percentage { get; set; }
        public string carbohydrate_percentage { get; set; }
        public string fiber_percentage { get; set; }
        public string moisture_percentage { get; set; }
        public string serving_size { get; set; }
        public int? servings_per_container { get; set; }
    }

    public class FoodItem
    {
        public string id { get; set; }
        public string pet_type { get; set; }
        public string name { get; set; }
        public string food_type { get; set; }
        public string description { get; set; }
        public string price { get; set; }
        public string image { get; set; }
        public NutritionalInfo nutritional_info { get; set; }
        public List<string> ingredients { get; set; }
        public string feeding_guidelines { get; set; }
        public string availability_status { get; set; }
        public int stock_quantity { get; set; }
        public DateTime created_at { get; set; }
        public DateTime updated_at { get; set; }
        public bool is_active { get; set; }
    }

    public class FoodApiResponse
    {
        public List<FoodItem> foods { get; set; }
        public int total_count { get; set; }
        public int? page { get; set; }
        public int? page_size { get; set; }
    }
}