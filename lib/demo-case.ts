import demoCaseFixture from "@/data/demo-case.json";

export type DemoDocketEntry = {
  sha: string;
  type: string;
  title: string;
  summary: string;
  author: string;
  date: string;
};

export type DemoCase = {
  id: string;
  title: string;
  court: string;
  docketNumber: string;
  status: "public";
  summary: string;
  entries: DemoDocketEntry[];
};

export const demoCase: DemoCase = {
  ...demoCaseFixture,
  status: "public",
};
