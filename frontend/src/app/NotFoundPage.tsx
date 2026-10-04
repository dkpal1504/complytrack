import { ButtonLink } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/Feedback";

export default function NotFoundPage() {
  return (
    <EmptyState
      icon="search"
      title="That page does not exist"
      description="The link may be out of date, or the record may have been archived. Try the register, or search for the obligation by its code."
      action={
        <>
          <ButtonLink to="/register" variant="primary" icon="list">
            Open the register
          </ButtonLink>
          <ButtonLink to="/" variant="secondary" icon="home">
            Back to My Work
          </ButtonLink>
        </>
      }
      className="py-24"
    />
  );
}
