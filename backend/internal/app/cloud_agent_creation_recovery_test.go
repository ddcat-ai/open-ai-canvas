package app

import "testing"

func TestAgentEventRecoveryReadsFromFirstEventAcrossPages(t *testing.T) {
	s, _, root := reliableAgentRoot(t)
	growAgentJournal(t, s, root.ID, 25)
	first, err := s.CloudAgentRun("user", root.ID, CloudAgentRunViewOptions{FromStart: true, EventLimit: 10})
	if err != nil {
		t.Fatal(err)
	}
	if len(first.Events) != 10 || first.Events[0].Seq != 1 || first.Events[9].Seq != 10 || first.EventCount != 25 {
		t.Fatalf("first recovery page = %+v", first)
	}
	second, err := s.CloudAgentRun("user", root.ID, CloudAgentRunViewOptions{SinceSeq: first.LatestSeq, EventLimit: 10})
	if err != nil {
		t.Fatal(err)
	}
	if len(second.Events) != 10 || second.Events[0].Seq != 11 || second.Events[9].Seq != 20 {
		t.Fatalf("second recovery page = %+v", second.Events)
	}
}
