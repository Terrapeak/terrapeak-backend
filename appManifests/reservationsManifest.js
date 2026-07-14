const reservationsManifest = {
  slug: "reservations",
  name: "Reservations",
  category: "operations",
  icon: "Calendar",
  launchMode: "external",

  navigation: {
    title: "Reservations",
    icon: "Calendar",
    items: [
  {
    name: "Dashboard",
    path: "/dashboard/reservations",
    externalPath: "",
    icon: "LayoutDashboard",
  },
  {
    name: "Calendar",
    path: "/dashboard/reservations/calendar",
    icon: "Calendar",
    disabled: true,
  },
  {
    name: "Analytics",
    path: "/dashboard/reservations/analytics",
    externalPath: "/analytics",
    icon: "BarChart3",
  },
  {
    name: "Settings",
    path: "/dashboard/reservations/settings",
    externalPath: "/settings",
    icon: "Settings",
  },
],
  },
};

export default reservationsManifest;