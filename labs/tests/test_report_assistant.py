import unittest
from labs.report_assistant import answer

class Provider:
    def __init__(self, references): self.references=references
    def call(self, actor, prompt, schema):
        assert actor == 'report_assistant'
        assert 'untrusted data' in prompt
        return {'output':{'answer':'The invoice supports the reported amount.','references':self.references},'tokens_in':30,'tokens_out':12}

class ReportAssistantTests(unittest.TestCase):
    def test_only_supplied_references_are_accepted(self):
        payload={'question':'Explain it','context':{'allowed_references':['invoices:INV-1']}}
        result=answer(payload,Provider(['invoices:INV-1']))
        self.assertEqual(result['references'],['invoices:INV-1'])
        self.assertEqual(result['usage']['tokens_in'],30)
        with self.assertRaises(ValueError): answer(payload,Provider(['invoices:INVENTED']))
