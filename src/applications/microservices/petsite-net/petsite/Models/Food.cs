using System.Collections.Generic;

namespace PetSite.Models
{
    public class Food
    {
        public string food_id { get; set; }
        public string food_for { get; set; }
        public string food_name { get; set; }
        public string food_type { get; set; }
        public string food_description { get; set; }
        public decimal food_price { get; set; }
        public string food_image { get; set; }
    }

    public class FoodResponse
    {
        public List<Food> foods { get; set; }
    }
}