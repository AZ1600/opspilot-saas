import { CommandCenter } from "@/components/command-center";
import { presentWorkspace, requireSession } from "@/lib/server/auth";
import { getWorkspaceRepository } from "@/lib/server/repository";

export default async function Home() {
  const session = await requireSession();
  const repository = getWorkspaceRepository();
  const workspace = await repository.read(session.businessId);

  return <CommandCenter initialWorkspace={presentWorkspace(workspace, session)} />;
}
