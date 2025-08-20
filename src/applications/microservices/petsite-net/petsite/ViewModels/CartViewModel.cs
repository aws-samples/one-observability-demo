using System;
using System.Collections.Generic;

namespace PetSite.ViewModels
{
    public class CartItem
    {
        public string food_id { get; set; }
        public string food_name { get; set; }
        public string food_image { get; set; }
        public int quantity { get; set; }
        public string unit_price { get; set; }
        public string total_price { get; set; }
        public bool is_available { get; set; }
        public DateTime added_at { get; set; }
    }

    public class CartResponse
    {
        public string user_id { get; set; }
        public List<CartItem> items { get; set; } = new List<CartItem>();
        public int total_items { get; set; }
        public string total_price { get; set; }
        public DateTime created_at { get; set; }
        public DateTime updated_at { get; set; }
    }
}