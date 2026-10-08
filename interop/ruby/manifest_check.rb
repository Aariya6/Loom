require 'json'
path = ARGV[0] || '../../data/source_manifest.json'
data = JSON.parse(File.read(File.expand_path(path, __dir__)))
abort 'no sources' unless data['sources'].is_a?(Array) && !data['sources'].empty?
puts "sources=#{data['sources'].length}"
