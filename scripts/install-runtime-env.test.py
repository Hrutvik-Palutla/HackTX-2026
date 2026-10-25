import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('runtime_env', Path(__file__).with_name('install-runtime-env.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

class RuntimeEnvTest(unittest.TestCase):
    def test_preserves_unrelated_settings_and_is_idempotent(self):
        values = {'APP_BASE_URL': 'https://getsidequest.tech', 'MODEL_API_KEY': 'test-key'}
        text = module.updated('SITE_ADDRESS=getsidequest.tech\nAPP_BASE_URL=http://old\nOTHER_SECRET=preserved\n', values)
        self.assertIn('OTHER_SECRET=preserved\n', text)
        self.assertIn('SITE_ADDRESS=getsidequest.tech\n', text)
        self.assertEqual(text, module.updated(text, values))
        self.assertEqual(text.count('APP_BASE_URL='), 1)

    def test_rejects_unexpected_keys_and_newlines(self):
        for values in ({'SSH_PRIVATE_KEY': 'no'}, {'MODEL_API_KEY': 'x\nBAD=1'}, {'MODEL_API_KEY': 1}):
            with self.assertRaises(ValueError):
                module.updated('', values)

if __name__ == '__main__':
    unittest.main()
