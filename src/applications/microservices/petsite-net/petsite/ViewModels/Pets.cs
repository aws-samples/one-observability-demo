using Microsoft.AspNetCore.Mvc.Rendering;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;

namespace PetSite.ViewModels
{
    public class Pet
    {
        public string pettype { get; set; }
        public string petid { get; set; }
        public string price { get; set; }
        public string petcolor { get; set; }
        public string cuteness_rate { get; set; }
        public string availability { get; set; }
        public string image { get; set; }
        public string peturl { get; set; }

        public string transactionid { get; set; }
        public string adoptiondate { get; set; }
        public string adoptedby { get; set; }
    }

    public class Variety
    {
        public IEnumerable<SelectListItem> PetTypes;
        public IEnumerable<SelectListItem> PetColors;

        public string SelectedPetType { get; set; }
        public string SelectedPetColor { get; set; }
    }

    public class PetDetails
    {
        public List<Pet> Pets { get; set; }
        public Variety Varieties { get; set; }
    }

    public class PetFood
    {
        public string EntityId { get; set; }
    }

    public class AdoptedPet
    {
        public string adoptiondate { get; set; }
        public string availability { get; set; }
        public string cuteness_rate { get; set; }
        public string email_lower { get; set; }
        public int name_length { get; set; }
        public string petcolor { get; set; }
        public string petid { get; set; }
        public string pettype { get; set; }
        public string peturl { get; set; }
        public string price { get; set; }
        public string transactionid { get; set; }
        public string user_email { get; set; }
        public string user_id { get; set; }
        public string user_name { get; set; }
    }

}
