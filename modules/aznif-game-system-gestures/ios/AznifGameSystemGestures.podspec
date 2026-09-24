Pod::Spec.new do |s|
  s.name = 'AznifGameSystemGestures'
  s.version = '1.0.0'
  s.summary = 'Native iOS bottom edge protection for Aznif game screens'
  s.description = s.summary
  s.license = { :type => 'Proprietary' }
  s.author = 'Aznif'
  s.homepage = 'https://aznif.com'
  s.platforms = { :ios => '16.4' }
  s.source = { :path => '.' }
  s.swift_version = '5.9'
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.source_files = '**/*.swift'
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES' }
end
