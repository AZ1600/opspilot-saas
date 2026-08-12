import { CommandCenter } from "@/components/command-center";
import { demoWorkspace } from "@/lib/demo-data";

export default function DemoPage() {
  return (
    <CommandCenter
      authMode="demo"
      initialWorkspace={{ ...demoWorkspace, onboardingCompleted: true }}
      isPublicDemo
    />
  );
}
